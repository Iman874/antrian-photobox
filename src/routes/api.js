const express = require('express');
const googleTTS = require('google-tts-api');
const { pool } = require('../config/db');
const { getStats } = require('../services/stats');
const { addClient, removeClient, sendSSE, generateClientId } = require('../services/sse');
const { broadcastAll } = require('../services/broadcast');

const router = express.Router();

const QUEUE_COOKIE = 'monobox_qid';

function getCookie(req, name) {
    const raw = req.headers.cookie || '';
    const match = raw.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function setQueueCookie(res, id) {
    res.setHeader('Set-Cookie', `${QUEUE_COOKIE}=${id}; Path=/; HttpOnly; Max-Age=43200`);
}

function clearQueueCookie(res) {
    res.setHeader('Set-Cookie', `${QUEUE_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

// Admin login API
router.post('/admin/login', async (req, res) => {
    const { password, studio_location } = req.body;
    try {
        const [users] = await pool.query(
            'SELECT * FROM users WHERE role = ? AND studio_location = ? AND password = ?',
            ['admin', studio_location, password]
        );
        if (users.length > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Password salah!' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// SSE Stream Endpoint
router.get('/stream/:location', (req, res) => {
    const location = req.params.location;

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.flushHeaders();

    const clientId = generateClientId();
    const newClient = { id: clientId, location, res };
    addClient(newClient);

    if (location === 'All') {
        getStats('Studio Utama').then(main => {
            getStats('Youth Center').then(youth => {
                res.write(`event: update_all_stats\n`);
                res.write(`data: ${JSON.stringify({ 'Studio Utama': main, 'Youth Center': youth })}\n\n`);
            });
        });
    } else {
        getStats(location).then(stats => {
            res.write(`event: update_stats\n`);
            res.write(`data: ${JSON.stringify(stats)}\n\n`);
        });
    }

    req.on('close', () => {
        removeClient(clientId);
    });
});

// Get statistics for a specific location
router.get('/stats/:location', async (req, res) => {
    try {
        const location = req.params.location;
        const stats = await getStats(location);
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const main = await getStats('Studio Utama');
        const youth = await getStats('Youth Center');
        res.json({ 'Studio Utama': main, 'Youth Center': youth });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Take a queue number
router.post('/queue', async (req, res) => {
    const { name, studio_location, sessions = 1, device_id } = req.body;
    try {
        const [sameName] = await pool.query(
            "SELECT * FROM queues WHERE LOWER(name) = LOWER(?) AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE() ORDER BY id DESC LIMIT 1",
            [name]
        );

        if (sameName.length > 0) {
            if (device_id && sameName[0].device_id === device_id) {
                setQueueCookie(res, sameName[0].id);
                return res.json({
                    success: true,
                    id: sameName[0].id,
                    name: sameName[0].name,
                    queue_number: sameName[0].queue_number,
                    studio_location: sameName[0].studio_location,
                    recovered: true
                });
            }
            return res.json({
                success: false,
                message: `Nama "${sameName[0].name}" sudah digunakan di antrian. Gunakan nama lain ya!`
            });
        }

        if (device_id) {
            const [existing] = await pool.query(
                "SELECT id, studio_location FROM queues WHERE device_id = ? AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE()",
                [device_id]
            );
            if (existing.length > 0) {
                setQueueCookie(res, existing[0].id);
                return res.json({
                    success: false,
                    message: `Kamu sudah punya antrian aktif di ${existing[0].studio_location}. Selesaikan atau batalkan dulu ya! 😊`
                });
            }
        }

        const [maxNum] = await pool.query(
            "SELECT MAX(CAST(queue_number AS UNSIGNED)) as max_num FROM queues WHERE studio_location = ? AND DATE(created_at) = CURDATE()",
            [studio_location]
        );
        const nextNum = ((maxNum[0].max_num || 0) + 1).toString().padStart(2, '0');
        const [result] = await pool.query(
            'INSERT INTO queues (name, queue_number, studio_location, sessions, device_id) VALUES (?, ?, ?, ?, ?)',
            [name, nextNum, studio_location, sessions, device_id || null]
        );

        await broadcastAll(studio_location);

        setQueueCookie(res, result.insertId);
        res.json({ success: true, id: result.insertId, name, queue_number: nextNum, studio_location });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cancel a queue number
router.post('/queue/cancel', async (req, res) => {
    const { id, studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['cancelled', id]);
        await broadcastAll(studio_location);
        clearQueueCookie(res);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin cancel a specific queue entry
router.post('/admin/cancel_queue', async (req, res) => {
    const { id, studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['cancelled', id]);
        await broadcastAll(studio_location);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Call Next
router.post('/admin/call_next', async (req, res) => {
    const { studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE studio_location = ? AND status = ?', ['done', studio_location, 'called']);
        const [next] = await pool.query('SELECT * FROM queues WHERE studio_location = ? AND status = ? ORDER BY id ASC LIMIT 1', [studio_location, 'waiting']);

        if (next.length > 0) {
            await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['called', next[0].id]);
            await broadcastAll(studio_location);
            sendSSE('play_audio', next[0], studio_location);
            res.json({ success: true, called: next[0] });
        } else {
            res.json({ success: false, message: 'No waiting queue' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Recall
router.post('/admin/recall', async (req, res) => {
    const { studio_location } = req.body;
    try {
        const [current] = await pool.query('SELECT * FROM queues WHERE studio_location = ? AND status = ? ORDER BY id DESC LIMIT 1', [studio_location, 'called']);
        if (current.length > 0) {
            sendSSE('play_audio', current[0], studio_location);
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'No active call' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Update Session Duration
router.post('/admin/duration', async (req, res) => {
    const { studio_location, duration } = req.body;
    try {
        await pool.query('UPDATE settings SET session_duration = ? WHERE studio_location = ?', [duration, studio_location]);
        await broadcastAll(studio_location);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Update Max Sessions
router.post('/admin/max_sessions', async (req, res) => {
    const { studio_location, max_sessions } = req.body;
    try {
        await pool.query('UPDATE settings SET max_sessions = ? WHERE studio_location = ?', [max_sessions, studio_location]);
        await broadcastAll(studio_location);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Reset System
router.post('/admin/reset', async (req, res) => {
    const { studio_location } = req.body;
    try {
        await pool.query('DELETE FROM queues WHERE studio_location = ?', [studio_location]);
        sendSSE('system_reset', null, studio_location);
        await broadcastAll(studio_location);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get queue list for a location (active only)
router.get('/queue/list/:location', async (req, res) => {
    try {
        const location = req.params.location;
        const [queues] = await pool.query(
            "SELECT id, name, queue_number, sessions, status, created_at FROM queues WHERE studio_location = ? AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE() ORDER BY id ASC",
            [location]
        );
        res.json(queues);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Check if device already has an active queue
router.get('/queue/device/:device_id', async (req, res) => {
    try {
        const [queues] = await pool.query(
            "SELECT * FROM queues WHERE device_id = ? AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE() ORDER BY id DESC LIMIT 1",
            [req.params.device_id]
        );
        if (queues.length > 0) {
            res.json({ found: true, queue: queues[0] });
        } else {
            res.json({ found: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Recover queue via HttpOnly cookie token (survives normal browser close)
router.get('/queue/recover/me', async (req, res) => {
    try {
        const qid = getCookie(req, QUEUE_COOKIE);
        if (!qid) return res.json({ found: false });
        const [rows] = await pool.query(
            'SELECT * FROM queues WHERE id = ? AND DATE(created_at) = CURDATE()',
            [qid]
        );
        if (rows.length === 0 || !['waiting', 'called'].includes(rows[0].status)) {
            clearQueueCookie(res);
            return res.json({ found: false });
        }
        const queue = rows[0];
        if (req.query.device_id) {
            await pool.query('UPDATE queues SET device_id = ? WHERE id = ?', [req.query.device_id, queue.id]);
        }
        res.json({ found: true, queue });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Recover client queue by name (fallback ketika cookie & device_id habis)
router.post('/queue/recover', async (req, res) => {
    const { name, studio_location, device_id } = req.body;
    try {
        const locs = studio_location ? [studio_location, null] : [null];
        let queue = null;
        for (const loc of locs) {
            const params = loc
                ? ['SELECT * FROM queues WHERE LOWER(name) = LOWER(?) AND studio_location = ? AND status IN (\'waiting\', \'called\') AND DATE(created_at) = CURDATE() ORDER BY id DESC LIMIT 1', [name, loc]]
                : ['SELECT * FROM queues WHERE LOWER(name) = LOWER(?) AND status IN (\'waiting\', \'called\') AND DATE(created_at) = CURDATE() ORDER BY id DESC LIMIT 1', [name]];
            const [rows] = await pool.query(params[0], params[1]);
            if (rows.length > 0) { queue = rows[0]; break; }
        }
        if (!queue) {
            return res.json({ success: false, message: 'Antrian tidak ditemukan' });
        }
        if (device_id) {
            await pool.query('UPDATE queues SET device_id = ? WHERE id = ?', [device_id, queue.id]);
        }
        setQueueCookie(res, queue.id);
        res.json({ success: true, queue });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get client queue position and estimation
router.get('/queue/:id', async (req, res) => {
    try {
        const [q] = await pool.query('SELECT * FROM queues WHERE id = ?', [req.params.id]);
        if (q.length === 0) return res.status(404).json({ error: 'Not found' });

        const queue = q[0];
        if (queue.status !== 'waiting') {
            return res.json({ queue, beforeCount: 0 });
        }

        const [before] = await pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(sessions), 0) as total_sessions FROM queues WHERE studio_location = ? AND status = ? AND id < ?', [queue.studio_location, 'waiting', queue.id]);
        res.json({ queue, beforeCount: before[0].cnt, beforeSessions: parseInt(before[0].total_sessions) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// TTS API
router.post('/tts', async (req, res) => {
    try {
        const { text } = req.body;
        const base64Audio = await googleTTS.getAudioBase64(text, {
            lang: 'id',
            slow: false,
            host: 'https://translate.google.com'
        });
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        res.set({ 'Content-Type': 'audio/mp3' });
        res.send(audioBuffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
