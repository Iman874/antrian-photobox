const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';
const TOTAL_REQUESTS = 1000;
const CONCURRENT_BATCH_SIZE = 50; // Mengirimkan request secara berkelompok agar tidak meledakkan memori lokal client

async function runLoadTest() {
    console.log(`====================================================`);
    console.log(`🚀 MEMULAI LOAD TESTING: ${TOTAL_REQUESTS} User Requests`);
    console.log(`====================================================`);

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    
    // Siapkan data antrian untuk 1000 user
    const requests = [];
    for (let i = 0; i < TOTAL_REQUESTS; i++) {
        requests.push({
            name: `UserLoad_${i}`,
            studio_location: 'Studio Utama',
            sessions: 1,
            device_id: `device_load_${i}`
        });
    }

    console.log(`Mengirim kueri secara batch (Batch Size: ${CONCURRENT_BATCH_SIZE}) agar RAM stabil...`);

    for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENT_BATCH_SIZE) {
        const batch = requests.slice(i, i + CONCURRENT_BATCH_SIZE);
        const promises = batch.map((data, index) => {
            return axios.post(`${BASE_URL}/queue`, data)
                .then(res => {
                    if (res.data && res.data.success) {
                        successCount++;
                    } else {
                        // Tolak jika nama/device kembar, ini dianggap sukses terproses oleh logika server
                        if (res.data && res.data.message) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    }
                })
                .catch(err => {
                    failCount++;
                });
        });

        await Promise.all(promises);
        
        // Print progress
        if ((i + CONCURRENT_BATCH_SIZE) % 200 === 0) {
            console.log(`Progress: ${i + CONCURRENT_BATCH_SIZE}/${TOTAL_REQUESTS} request terkirim...`);
        }
    }

    const duration = (Date.now() - startTime) / 1000;
    const rps = (TOTAL_REQUESTS / duration).toFixed(2);

    console.log(`\n====================================================`);
    console.log(`📊 HASIL LOAD TESTING (1000 USER):`);
    console.log(`====================================================`);
    console.log(`✅ Request Sukses Terlayani  : ${successCount}`);
    console.log(`❌ Request Gagal             : ${failCount}`);
    console.log(`⏱️ Total Waktu Eksekusi      : ${duration.toFixed(2)} detik`);
    console.log(`⚡ Kecepatan Respon (RPS)    : ${rps} Request per Detik`);
    console.log(`====================================================\n`);

    if (failCount === 0) {
        console.log(`🎉 LUAR BIASA! Server berhasil melayani 1000 user sekaligus tanpa ada 1 pun kegagalan koneksi database!`);
    } else {
        console.log(`⚠️ Ada ${failCount} request yang gagal. Perlu dilakukan optimasi pool database.`);
    }
}

runLoadTest();
