const { pool } = require('../config/db');

async function getStats(location) {
    const [waiting] = await pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(sessions), 0) as total_sessions FROM queues WHERE studio_location = ? AND status = ?', [location, 'waiting']);
    const [total] = await pool.query('SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ?', [location]);
    const [nowServing] = await pool.query("SELECT * FROM queues WHERE studio_location = ? AND status = 'called' ORDER BY id DESC LIMIT 1", [location]);
    const [settings] = await pool.query('SELECT * FROM settings WHERE studio_location = ?', [location]);

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

module.exports = {
    getStats
};
