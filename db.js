const mysql = require('mysql2/promise');

// ============================================================
// Konfigurasi Database Otomatis (Lokal & cPanel)
// ------------------------------------------------------------
// Cara kerja:
//   - Di LOKAL   : langsung `node server.js` (default localhost)
//   - Di cPANEL  : set env variable di hosting, contoh:
//                   NODE_ENV=production node server.js
//     atau set DB_HOST, DB_USER, DB_PASS, DB_NAME satu per satu
// ============================================================

const isProduction = process.env.NODE_ENV === 'production';

const dbConfig = {
    host: process.env.DB_HOST || (isProduction ? 'localhost' : 'localhost'),
    user: process.env.DB_USER || (isProduction ? 'monf3757_antrian_photobox' : 'root'),
    password: process.env.DB_PASS || (isProduction ? 'I({x^OF]?-dzUi9S' : ''),
    database: process.env.DB_NAME || (isProduction ? 'monf3757_antrian_photobox' : 'antrian_photobox'),
};

console.log(`[DB] Mode: ${isProduction ? 'PRODUCTION (cPanel)' : 'LOCAL (Development)'}`);
console.log(`[DB] Host: ${dbConfig.host} | Database: ${dbConfig.database}`);

const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    // Pada cPanel, database sudah dibuat manual, jadi query CREATE DATABASE dihilangkan
    // untuk mencegah error "Access Denied" karena user cPanel biasa tidak memiliki
    // permission untuk membuat database baru via query.

    // Now create tables
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'client') DEFAULT 'client',
            studio_location VARCHAR(255)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS queues (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            queue_number VARCHAR(10) NOT NULL,
            studio_location VARCHAR(255) NOT NULL,
            status ENUM('waiting', 'called', 'done', 'cancelled') DEFAULT 'waiting',
            sessions INT DEFAULT 1,
            device_id VARCHAR(64) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Add device_id column if not exists (for existing tables)
    try {
        await pool.query(`ALTER TABLE queues ADD COLUMN device_id VARCHAR(64) DEFAULT NULL`);
    } catch (e) {
        // Column already exists, ignore
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_duration INT DEFAULT 7,
            max_sessions INT DEFAULT 2,
            studio_location VARCHAR(255) NOT NULL UNIQUE
        );
    `);

    // Insert default settings
    await pool.query(`INSERT IGNORE INTO settings (studio_location, session_duration) VALUES ('Studio Utama', 7)`);
    await pool.query(`INSERT IGNORE INTO settings (studio_location, session_duration) VALUES ('Youth Center', 5)`);

    // Insert default admin
    await pool.query(`INSERT IGNORE INTO users (username, password, role, studio_location) VALUES ('admin1', 'admin', 'admin', 'Studio Utama')`);
    await pool.query(`INSERT IGNORE INTO users (username, password, role, studio_location) VALUES ('admin2', 'admin', 'admin', 'Youth Center')`);

    console.log("Database initialized.");
}

module.exports = {
    pool,
    initDB
};
