const axios = require('axios');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'https://antrian.photobox.monogroup.cloud/api';
const USERS = parseInt(process.env.USERS || '30', 10);
const DURATION_SEC = parseInt(process.env.DURATION || '30', 10); // berapa lama simulasi berjalan
const POLL_MS = 5000; // polling /api/stats tiap 5 detik (sama seperti antrian.html)
const CALL_NEXT_INTERVAL_MS = parseInt(process.env.CALL_INTERVAL || '3000', 10); // call_next tiap 3 detik

// Ambil antrian dulu untuk tiap user (biar punya myQueueId untuk checkMyQueue)
async function takeQueue(i) {
    const res = await axios.post(`${BASE_URL}/queue`, {
        name: `SimUser_${i}`,
        studio_location: 'Studio Utama',
        sessions: 1,
        device_id: `simdevice_${i}`
    });
    return res.data.id;
}

// Buka koneksi SSE (persisten, seperti EventSource di browser)
function openSSE(loc) {
    return new Promise((resolve) => {
        const mod = BASE_URL.startsWith('https') ? https : http;
        const req = mod.get(`${BASE_URL}/stream/${encodeURIComponent(loc)}`, (res) => {
            res.on('data', () => { /* buang data, hanya jaga koneksi tetap hidup */ });
            res.on('error', () => {});
        });
        req.on('error', () => {});
        resolve(req);
    });
}

// Simulasi satu user aktif: polling stats + checkMyQueue tiap 5 detik
async function simulateUser(i, queueId, loc) {
    let pollCount = 0;
    let checkCount = 0;
    let fail = 0;

    const interval = setInterval(async () => {
        try {
            await axios.get(`${BASE_URL}/stats/${encodeURIComponent(loc)}`);
            pollCount++;
        } catch (e) { fail++; }

        try {
            await axios.get(`${BASE_URL}/queue/${queueId}`);
            checkCount++;
        } catch (e) { fail++; }
    }, POLL_MS);

    return { interval, getStats: () => ({ pollCount, checkCount, fail }) };
}

async function run() {
    console.log(`Simulasi ${USERS} user AKTIF (SSE + polling 5s + checkMyQueue) selama ${DURATION_SEC}s`);
    console.log(`Target: ${BASE_URL}`);
    console.log('==========================================');

    const loc = 'Studio Utama';

    // 1. Ambil antrian untuk semua user
    console.log('Mengambil antrian untuk semua user...');
    const queueIds = [];
    for (let i = 0; i < USERS; i++) {
        try { queueIds.push(await takeQueue(i)); } catch (e) { console.log(`  user ${i} gagal ambil antrian`); }
    }
    console.log(`  ${queueIds.length}/${USERS} user punya antrian.`);

    // 2. Buka SSE untuk semua user
    console.log('Membuka koneksi SSE untuk semua user...');
    const sseConns = [];
    for (let i = 0; i < USERS; i++) {
        sseConns.push(await openSSE(loc));
    }
    console.log(`  ${sseConns.length} koneksi SSE terbuka.`);

    // 3. Mulai polling + checkMyQueue untuk semua user
    console.log(`Memulai polling + checkMyQueue tiap ${POLL_MS}ms selama ${DURATION_SEC}s...`);
    const users = [];
    for (let i = 0; i < queueIds.length; i++) {
        users.push(await simulateUser(i, queueIds[i], loc));
    }

    // 3b. Mutasi call_next berulang (simulasi admin memanggil antrian)
    //     Memicu broadcastAll (getStats 2 lokasi) + semua klien checkMyQueue serentak
    let callCount = 0, callFail = 0;
    const callInterval = setInterval(async () => {
        try {
            const res = await axios.post(`${BASE_URL}/admin/call_next`, { studio_location: loc });
            if (res.data && res.data.success) callCount++;
            else callFail++;
        } catch (e) { callFail++; }
    }, CALL_NEXT_INTERVAL_MS);

    // 4. Tunggu selama durasi
    await new Promise(r => setTimeout(r, DURATION_SEC * 1000));

    // 5. Hentikan semua interval & tutup SSE
    clearInterval(callInterval);
    let totalPoll = 0, totalCheck = 0, totalFail = 0;
    for (const u of users) {
        clearInterval(u.interval);
        const s = u.getStats();
        totalPoll += s.pollCount;
        totalCheck += s.checkCount;
        totalFail += s.fail;
    }
    for (const req of sseConns) { try { req.destroy(); } catch (e) {} }

    console.log('==========================================');
    console.log('HASIL SIMULASI 30 USER AKTIF:');
    console.log(`  Total polling /api/stats  : ${totalPoll}`);
    console.log(`  Total checkMyQueue        : ${totalCheck}`);
    console.log(`  Total request gagal       : ${totalFail}`);
    console.log(`  Koneksi SSE               : ${sseConns.length}`);
    console.log(`  call_next sukses          : ${callCount}`);
    console.log(`  call_next gagal           : ${callFail}`);
    console.log('==========================================');
    console.log('Cek CPU VPS sekarang (htop / pm2 monit) — apakah naik drastis?');
    process.exit(0);
}

run();
