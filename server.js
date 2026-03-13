const express = require('express');
const http = require('http');
const path = require('path');
const { pool, initDB } = require('./db.js');
const cors = require('cors');
const googleTTS = require('google-tts-api');

const app = express();
const server = http.createServer(app);
const falback = 500;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// HTML Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/indoor/queue', (req, res) => res.sendFile(path.join(__dirname, 'public', 'antrian.html')));
app.get('/outdoor/queue', (req, res) => res.sendFile(path.join(__dirname, 'public', 'antrian.html')));

// Admin selector page
app.get('/monoframe', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Admin dashboard (protected by client-side password)
app.get('/admin/indoor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin/outdoor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.get('/display/indoor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/display/outdoor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

// Admin login API
app.post('/api/admin/login', async (req, res) => {
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

async function getStats(location) {
    const [waiting] = await pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(sessions), 0) as total_sessions FROM queues WHERE studio_location = ? AND status = ?', [location, 'waiting']);
    const [total] = await pool.query('SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ?', [location]);
    // Ambil antrian terakhir yang sedang dipanggil atau sudah selesai (agar layar tidak kosong jika tidak ada antrian baru)
    const [nowServing] = await pool.query("SELECT * FROM queues WHERE studio_location = ? AND status = 'called' ORDER BY id DESC LIMIT 1", [location]);
    const [settings] = await pool.query('SELECT * FROM settings WHERE studio_location = ?', [location]);

    // Ambil daftar antrian aktif (waiting + called) hari ini
    const [queueList] = await pool.query(
        "SELECT id, name, queue_number, sessions, status, created_at FROM queues WHERE studio_location = ? AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE() ORDER BY id ASC",
        [location]
    );

    return {
        waiting: waiting[0].cnt,
        waiting_sessions: parseInt(waiting[0].total_sessions),
        total: total[0].cnt,
        nowServing: nowServing.length > 0 ? nowServing[0] : null,
        session_duration: settings.length > 0 ? settings[0].session_duration : 7,
        max_sessions: settings.length > 0 ? settings[0].max_sessions : 2,
        queue_list: queueList
    };
}


// Manajemen Klien SSE
const clients = [];

// Fungsi untuk mengirim Event/Pesan ke semua klien yang terhubung (Broadcast SSE)
function sendSSE(event, data, loc = null) {
    clients.forEach(c => {
        try {
            if (!loc || c.location === loc || c.location === 'All') {
                c.res.write(`event: ${event}\n`);
                c.res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        } catch (e) {
            // Koneksi sudah mati, abaikan
        }
    });
}

// Fungsi helper untuk broadcast ke semua klien setelah perubahan data
async function broadcastAll(studio_location) {
    sendSSE('update_stats', await getStats(studio_location), studio_location);
    const main = await getStats('Studio Utama');
    const youth = await getStats('Youth Center');
    sendSSE('update_all_stats', { 'Studio Utama': main, 'Youth Center': youth });
}

// Heartbeat setiap 30 detik agar koneksi SSE tidak diputus proxy LiteSpeed/cPanel
setInterval(() => {
    clients.forEach(c => {
        try { c.res.write(': keepalive\n\n'); } catch (e) { /* abaikan */ }
    });
}, 30000);

// Endpoint Pendaftaran/Stream SSE
app.get('/api/stream/:location', (req, res) => {
    const location = req.params.location;

    // Headers wajib untuk Server-Sent Events (SSE)
    // X-Accel-Buffering: no → mencegah LiteSpeed/Nginx mem-buffer response
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    // Flush headers segera
    res.flushHeaders();

    // Daftarkan klien baru ke dalam array
    const newClient = { id: Date.now(), location, res };
    clients.push(newClient);

    // Kirim data awal sesaat setelah terhubung
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

    // Bersihkan klien saat koneksi terputus/ditutup browser
    req.on('close', () => {
        const index = clients.findIndex(c => c.id === newClient.id);
        if (index !== -1) {
            clients.splice(index, 1);
        }
    });
});

// APIs

// Get statistics for a specific location
app.get('/api/stats/:location', async (req, res) => {
    try {
        const location = req.params.location;
        const stats = await getStats(location);
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const main = await getStats('Studio Utama');
        const youth = await getStats('Youth Center');
        res.json({ 'Studio Utama': main, 'Youth Center': youth });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Take a queue number
app.post('/api/queue', async (req, res) => {
    const { name, studio_location, sessions = 1, device_id } = req.body;
    try {
        // Cek apakah device_id sudah punya antrian aktif di lokasi manapun
        if (device_id) {
            const [existing] = await pool.query(
                "SELECT id, studio_location FROM queues WHERE device_id = ? AND status IN ('waiting', 'called') AND DATE(created_at) = CURDATE()",
                [device_id]
            );
            if (existing.length > 0) {
                return res.json({
                    success: false,
                    message: `Kamu sudah punya antrian aktif di ${existing[0].studio_location}. Selesaikan atau batalkan dulu ya! 😊`
                });
            }
        }

        // Hitung nomor antrian berikutnya (hanya yang non-cancelled)
        const [activeCount] = await pool.query(
            "SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ? AND status != 'cancelled' AND DATE(created_at) = CURDATE()",
            [studio_location]
        );
        const nextNum = (activeCount[0].cnt + 1).toString().padStart(2, '0');
        const [result] = await pool.query(
            'INSERT INTO queues (name, queue_number, studio_location, sessions, device_id) VALUES (?, ?, ?, ?, ?)',
            [name, nextNum, studio_location, sessions, device_id || null]
        );

        await broadcastAll(studio_location);

        res.json({ success: true, id: result.insertId, name, queue_number: nextNum, studio_location });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper: Re-number antrian yang masih waiting setelah cancel
async function renumberQueue(studio_location) {
    // Hitung berapa yang sudah called/done hari ini (nomor mereka tetap)
    const [doneCount] = await pool.query(
        "SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ? AND status IN ('called', 'done') AND DATE(created_at) = CURDATE()",
        [studio_location]
    );
    const startNum = doneCount[0].cnt + 1;

    // Ambil semua yang masih waiting, urutkan berdasarkan id
    const [waitingQueues] = await pool.query(
        "SELECT id FROM queues WHERE studio_location = ? AND status = 'waiting' AND DATE(created_at) = CURDATE() ORDER BY id ASC",
        [studio_location]
    );

    // Re-assign nomor antrian secara berurutan
    for (let i = 0; i < waitingQueues.length; i++) {
        const newNum = (startNum + i).toString().padStart(2, '0');
        await pool.query('UPDATE queues SET queue_number = ? WHERE id = ?', [newNum, waitingQueues[i].id]);
    }
}

// Cancel a queue number
app.post('/api/queue/cancel', async (req, res) => {
    const { id, studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['cancelled', id]);

        // Re-number antrian yang tersisa
        await renumberQueue(studio_location);

        await broadcastAll(studio_location);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin cancel a specific queue entry
app.post('/api/admin/cancel_queue', async (req, res) => {
    const { id, studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['cancelled', id]);

        // Re-number antrian yang tersisa
        await renumberQueue(studio_location);

        await broadcastAll(studio_location);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Call Next
app.post('/api/admin/call_next', async (req, res) => {
    const { studio_location } = req.body;
    try {
        // Mark current called as done
        await pool.query('UPDATE queues SET status = ? WHERE studio_location = ? AND status = ?', ['done', studio_location, 'called']);

        // Find next waiting
        const [next] = await pool.query('SELECT * FROM queues WHERE studio_location = ? AND status = ? ORDER BY id ASC LIMIT 1', [studio_location, 'waiting']);

        if (next.length > 0) {
            await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['called', next[0].id]);

            await broadcastAll(studio_location);
            // emit audio event
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
app.post('/api/admin/recall', async (req, res) => {
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
app.post('/api/admin/duration', async (req, res) => {
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
app.post('/api/admin/max_sessions', async (req, res) => {
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
app.post('/api/admin/reset', async (req, res) => {
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
app.get('/api/queue/list/:location', async (req, res) => {
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

// Get client queue position and estimation
app.get('/api/queue/:id', async (req, res) => {
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
app.post('/api/tts', async (req, res) => {
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

initDB().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        const os = require('os');
        const nets = os.networkInterfaces();
        let localIP = 'localhost';
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    localIP = net.address;
                }
            }
        }
        console.log('');
        console.log('===========================================');
        console.log('  🎉 Server Antrian Monobox Ready!');
        console.log('===========================================');
        console.log(`  📱 Client   : http://${localIP}:3000`);
        console.log(`  🔐 Admin    : http://${localIP}:3000/monoframe`);
        console.log(`  📺 Display  : http://${localIP}:3000/display/indoor`);
        console.log('===========================================');
        console.log('');
    });
}).catch(console.error);
