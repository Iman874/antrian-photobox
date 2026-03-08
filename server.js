const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { pool, initDB } = require('./db.js');
const cors = require('cors');
const googleTTS = require('google-tts-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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
    const [nowServing] = await pool.query('SELECT * FROM queues WHERE studio_location = ? AND status = ? ORDER BY id DESC LIMIT 1', [location, 'called']);
    const [settings] = await pool.query('SELECT * FROM settings WHERE studio_location = ?', [location]);

    return {
        waiting: waiting[0].cnt,
        waiting_sessions: parseInt(waiting[0].total_sessions),
        total: total[0].cnt,
        nowServing: nowServing.length > 0 ? nowServing[0] : null,
        session_duration: settings.length > 0 ? settings[0].session_duration : 7,
        max_sessions: settings.length > 0 ? settings[0].max_sessions : 2
    };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_location', async (location) => {
        socket.join(location);
        const stats = await getStats(location);
        socket.emit('update_stats', stats);
    });

    socket.on('get_all_stats', async () => {
        const stats1 = await getStats('Studio Utama');
        const stats2 = await getStats('Youth Center');
        socket.emit('update_all_stats', { 'Studio Utama': stats1, 'Youth Center': stats2 });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
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
    const { name, studio_location, sessions = 1 } = req.body;
    try {
        const [todayCount] = await pool.query('SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ? AND DATE(created_at) = CURDATE()', [studio_location]);
        const nextNum = (todayCount[0].cnt + 1).toString().padStart(2, '0');
        const [result] = await pool.query('INSERT INTO queues (name, queue_number, studio_location, sessions) VALUES (?, ?, ?, ?)', [name, nextNum, studio_location, sessions]);
        
        io.to(studio_location).emit('update_stats', await getStats(studio_location));
        const statsMain = await getStats('Studio Utama');
        const statsYouth = await getStats('Youth Center');
        io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });

        res.json({ id: result.insertId, name, queue_number: nextNum, studio_location });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cancel a queue number
app.post('/api/queue/cancel', async (req, res) => {
    const { id, studio_location } = req.body;
    try {
        await pool.query('UPDATE queues SET status = ? WHERE id = ?', ['cancelled', id]);
        io.to(studio_location).emit('update_stats', await getStats(studio_location));
        
        const statsMain = await getStats('Studio Utama');
        const statsYouth = await getStats('Youth Center');
        io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });

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
            
            const stats = await getStats(studio_location);
            io.to(studio_location).emit('update_stats', stats);
            // emit audio event
            io.to(studio_location).emit('play_audio', next[0]);

            const statsMain = await getStats('Studio Utama');
            const statsYouth = await getStats('Youth Center');
            io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });

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
            io.to(studio_location).emit('play_audio', current[0]);
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
        const stats = await getStats(studio_location);
        io.to(studio_location).emit('update_stats', stats);
        
        const statsMain = await getStats('Studio Utama');
        const statsYouth = await getStats('Youth Center');
        io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });
        
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
        const stats = await getStats(studio_location);
        io.to(studio_location).emit('update_stats', stats);
        
        const statsMain = await getStats('Studio Utama');
        const statsYouth = await getStats('Youth Center');
        io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });
        
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
        
        const stats = await getStats(studio_location);
        io.to(studio_location).emit('system_reset');
        io.to(studio_location).emit('update_stats', stats);
        
        const statsMain = await getStats('Studio Utama');
        const statsYouth = await getStats('Youth Center');
        io.emit('update_all_stats', { 'Studio Utama': statsMain, 'Youth Center': statsYouth });

        res.json({ success: true });
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
        res.set({'Content-Type': 'audio/mp3'});
        res.send(audioBuffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

initDB().then(() => {
    server.listen(3000, '0.0.0.0', () => {
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
        console.log('  🎉 Server Antrian Photobox Ready!');
        console.log('===========================================');
        console.log(`  📱 Client   : http://${localIP}:3000`);
        console.log(`  🔐 Admin    : http://${localIP}:3000/monoframe`);
        console.log(`  📺 Display  : http://${localIP}:3000/display/indoor`);
        console.log('===========================================');
        console.log('');
    });
}).catch(console.error);
