const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'antrian.photobox.monoframe.id',
    user: 'monf3757_antrian_photobox',
    password: 'I({x^OF]?-dzUi9S',
    database: 'monf3757_antrian_photobox',
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

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
