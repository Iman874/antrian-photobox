const express = require('express');
const path = require('path');
const router = express.Router();

const publicDir = path.join(__dirname, '../../public');

router.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
router.get('/indoor/queue', (req, res) => res.sendFile(path.join(publicDir, 'antrian.html')));
router.get('/outdoor/queue', (req, res) => res.sendFile(path.join(publicDir, 'antrian.html')));
router.get('/monoframe', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
router.get('/admin/indoor', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
router.get('/admin/outdoor', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
router.get('/display/indoor', (req, res) => res.sendFile(path.join(publicDir, 'display.html')));
router.get('/display/outdoor', (req, res) => res.sendFile(path.join(publicDir, 'display.html')));

module.exports = router;
