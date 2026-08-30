const { pool } = require('../config/db');

async function getStats(location, db = pool) {
    const [waiting] = await db.query('SELECT COUNT(*) as cnt, COALESCE(SUM(sessions), 0) as total_sessions FROM queues WHERE studio_location = ? AND status = ?', [location, 'waiting']);
    const [total] = await db.query('SELECT COUNT(*) as cnt FROM queues WHERE studio_location = ?', [location]);
    const [nowServing] = await db.query("SELECT * FROM queues WHERE studio_location = ? AND status = 'called' ORDER BY sort_order DESC, id DESC LIMIT 1", [location]);
    const [settings] = await db.query('SELECT * FROM settings WHERE studio_location = ?', [location]);

    const [queueList] = await db.query(
        "SELECT id, name, queue_number, sessions, status, created_at FROM queues WHERE studio_location = ? AND status IN ('waiting', 'called') ORDER BY sort_order ASC, id ASC",
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
