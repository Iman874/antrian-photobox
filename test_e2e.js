const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000/api';

async function runTests() {
    console.log("Memulai End-to-End System Testing...");
    const STUDIO_1 = 'Studio Utama';
    const STUDIO_2 = 'Youth Center';

    try {
        // SCENARIO 9: SYSTEM RESET (Setup awal)
        console.log("\n--- Menyiapkan sistem (Reset) ---");
        await axios.post(`${BASE_URL}/admin/reset`, { studio_location: STUDIO_1 });
        await axios.post(`${BASE_URL}/admin/reset`, { studio_location: STUDIO_2 });
        // Set default duration
        await axios.post(`${BASE_URL}/admin/duration`, { studio_location: STUDIO_1, duration: 5 });
        
        let stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.total, 0);
        assert.strictEqual(stats1.waiting, 0);
        console.log("✅ System Reset berhasil.");

        // SCENARIO 1 & 2: MULTIPLE CLIENT AMBIL ANTRIAN
        console.log("\n--- Skenario 1 & 2: Client Mengambil Antrian ---");
        const names = ['Fikri', 'Andi', 'Rina', 'Budi', 'Dina', 'Sari', 'Rudi', 'Tika', 'Rizal', 'Nina'];
        const clients = [];

        for (let i = 0; i < names.length; i++) {
            const res = await axios.post(`${BASE_URL}/queue`, { name: names[i], studio_location: STUDIO_1 });
            clients.push(res.data);
            assert.strictEqual(res.data.queue_number, `A${String(i+1).padStart(3, '0')}`);
        }
        
        stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.total, 10);
        assert.strictEqual(stats1.waiting, 10);
        console.log("✅ 10 Client berhasil antri. Waiting List = 10.");

        // Cek Estimasi Waktu (Client ke-3: Rina)
        // Rina adalah client ke-3 (id: clients[2].id). Di depannya ada 2 orang yang waiting.
        let rinaStatus = (await axios.get(`${BASE_URL}/queue/${clients[2].id}`)).data;
        assert.strictEqual(rinaStatus.beforeCount, 2);
        console.log(`✅ Estimasi antrian bekerja: Di depan Rina ada ${rinaStatus.beforeCount} orang.`);

        // SCENARIO 3 & 4: ADMIN MEMANGGIL ANTRIAN (CALL NEXT)
        console.log("\n--- Skenario 3 & 4: Admin Call Next ---");
        let callRes = await axios.post(`${BASE_URL}/admin/call_next`, { studio_location: STUDIO_1 });
        assert.strictEqual(callRes.data.called.queue_number, 'A001');
        
        stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.waiting, 9);
        assert.strictEqual(stats1.nowServing.queue_number, 'A001');
        console.log(`✅ Call Next 1: Now Serving = ${stats1.nowServing.queue_number}, Waiting = ${stats1.waiting}`);

        // SCENARIO 5: RECALL SIGNAL
        console.log("\n--- Skenario 5: Recall Signal ---");
        let recallRes = await axios.post(`${BASE_URL}/admin/recall`, { studio_location: STUDIO_1 });
        assert.strictEqual(recallRes.data.success, true);
        console.log("✅ Admin berhasil melakukan Recall (Kirim Socket event).");

        // SCENARIO 6: CLIENT CANCEL ANTRIAN
        console.log("\n--- Skenario 6: Client Cancel Antrian ---");
        // Andi (Client ke-2) cancel antriannya.
        await axios.post(`${BASE_URL}/queue/cancel`, { id: clients[1].id, studio_location: STUDIO_1 });
        stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.waiting, 8); // sisa 8
        console.log(`✅ Andi cancel antrian. Waiting list menjadi ${stats1.waiting}.`);
        
        // Rina cek sisa antrian di depannya. Tadi ada 2, A001 dipanggil, A002(Andi) cancel. Sisanya 0!
        rinaStatus = (await axios.get(`${BASE_URL}/queue/${clients[2].id}`)).data;
        assert.strictEqual(rinaStatus.beforeCount, 0);
        console.log(`✅ Rina antrian berikutnya! Di depan Rina ada ${rinaStatus.beforeCount} orang.`);

        // SCENARIO 7: PERUBAHAN DURASI SESI
        console.log("\n--- Skenario 7: Ubah Durasi Sesi ---");
        await axios.post(`${BASE_URL}/admin/duration`, { studio_location: STUDIO_1, duration: 3 });
        stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.session_duration, 3);
        console.log(`✅ Durasi sesi berhasil diubah menjadi ${stats1.session_duration} menit (Sistem realtime akan memberitahukan update event ini ke client)`);

        // SCENARIO 10: MULTI STUDIO ISOLATION
        console.log("\n--- Skenario 10: Multi Studio Isolation ---");
        await axios.post(`${BASE_URL}/queue`, { name: 'Client Luar', studio_location: STUDIO_2 });
        let stats2 = (await axios.get(`${BASE_URL}/stats/${STUDIO_2}`)).data;
        assert.strictEqual(stats2.waiting, 1);
        
        // Pastikan Studio 1 tak berubah karena Studio 2
        stats1 = (await axios.get(`${BASE_URL}/stats/${STUDIO_1}`)).data;
        assert.strictEqual(stats1.waiting, 8);
        console.log("✅ Antrian Studio Utama dan Youth Center terisolasi dengan sempurna!");

        console.log("\n🎉 SELURUH SKENARIO E2E SYSTEM TESTING BERHASIL TERLEWATI! 🎉");

    } catch (e) {
        console.error("❌ PENGUJIAN GAGAL!", e.response ? e.response.data : e.message);
    }
}

runTests();
