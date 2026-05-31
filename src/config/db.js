// Load environment variables via custom loader
require('./load-env.js');
const mysql = require('mysql2/promise');

const isProduction = process.env.NODE_ENV === 'production';

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'antrian_photobox',
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
    // 1. Otomatis buat database jika belum ada (berguna untuk pengembangan lokal)
    try {
        console.log(`[DB] Memeriksa apakah database "${dbConfig.database}" sudah ada...`);
        const tempConn = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
        await tempConn.end();
        console.log(`[DB] Database "${dbConfig.database}" siap/berhasil dibuat.`);
    } catch (err) {
        // Abaikan error "Access Denied" (biasanya terjadi di cPanel karena hak akses user terbatas)
        // karena di cPanel database biasanya sudah dibuat secara manual sebelumnya.
        console.log(`[DB] Info: Melewati auto-create database (kemungkinan berjalan di cPanel/user terbatas): ${err.message}`);
    }

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
