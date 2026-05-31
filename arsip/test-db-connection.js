// Test DB Connection
require('./load-env.js');
const mysql = require('mysql2/promise');

async function testConnection() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });

        console.log('✅ Koneksi berhasil!');
        console.log('Host:', process.env.DB_HOST);
        console.log('User:', process.env.DB_USER);
        console.log('Database:', process.env.DB_NAME);

        // Test query
        const [rows] = await connection.query('SELECT 1 as test');
        console.log('✅ Query berhasil:', rows);

        await connection.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Code:', error.code);
    }
}

testConnection();
