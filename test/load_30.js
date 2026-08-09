const axios = require('axios');

// Ganti BASE_URL sesuai target: domain VPS atau localhost
const BASE_URL = process.env.BASE_URL || 'https://antrian.photobox.monogroup.cloud/api';
const TOTAL = 30;
const CONCURRENT = 30; // semua bersamaan

async function run() {
    console.log(`Load test ${TOTAL} user bersamaan ke ${BASE_URL}`);
    const start = Date.now();
    let ok = 0, fail = 0;

    const reqs = [];
    for (let i = 0; i < TOTAL; i++) {
        reqs.push({
            name: `User30_${i}`,
            studio_location: 'Studio Utama',
            sessions: 1,
            device_id: `device30_${i}`
        });
    }

    const promises = reqs.map((data) =>
        axios.post(`${BASE_URL}/queue`, data)
            .then(res => {
                if (res.data && (res.data.success || res.data.message)) ok++;
                else fail++;
            })
            .catch(() => fail++)
    );

    await Promise.all(promises);

    const dur = ((Date.now() - start) / 1000).toFixed(2);
    console.log('==========================================');
    console.log(`Sukses : ${ok}`);
    console.log(`Gagal  : ${fail}`);
    console.log(`Waktu  : ${dur} detik`);
    console.log(`RPS    : ${(TOTAL / dur).toFixed(2)}`);
    console.log('==========================================');
    process.exit(fail ? 1 : 0);
}

run();
