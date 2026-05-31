// Load environment variables
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { initDB } = require('./src/config/db.js');

const pageRouter = require('./src/routes/pages.js');
const apiRouter = require('./src/routes/api.js');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Load page and api routers
app.use('/', pageRouter);
app.use('/api', apiRouter);

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
