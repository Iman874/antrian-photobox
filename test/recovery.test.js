const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000/api';
const STUDIO = 'Studio Utama';

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function bad(name, err) { failed++; console.error(`  ❌ ${name}: ${err}`); }

async function reset() {
    await axios.post(`${BASE_URL}/admin/reset`, { studio_location: STUDIO });
    await axios.post(`${BASE_URL}/admin/reset`, { studio_location: 'Youth Center' });
}

async function recoverByCookie(qid) {
    const res = await axios.get(`${BASE_URL}/queue/recover/me`, {
        headers: qid ? { Cookie: `monobox_qid=${qid}` } : {}
    });
    return res.data;
}

async function recoverByName(payload) {
    const res = await axios.post(`${BASE_URL}/queue/recover`, payload);
    return res.data;
}

async function runTests() {
    console.log("Memulai Unit Testing Recovery Antrian (Cookie / Device / Nama)...");

    try {
        await reset();

        // ==== LAPIS A: COOKIE ====
        console.log('\n--- Lapis A: recovery via cookie ---');

        // A1. Tanpa cookie → found:false
        let data = await recoverByCookie(null);
        assert.strictEqual(data.found, false);
        ok('Tanpa cookie → { found:false }');

        // A2. Cookie token valid → found:true
        const take = await axios.post(`${BASE_URL}/queue`, {
            name: 'Devi Andini', studio_location: STUDIO, sessions: 1, device_id: 'dev-cookie-1'
        });
        data = await recoverByCookie(take.data.id);
        assert.strictEqual(data.found, true);
        assert.strictEqual(data.queue.id, take.data.id);
        assert.strictEqual(data.queue.status, 'waiting');
        ok('Cookie valid → antrian direstore (id & status benar)');

        // A3. Cookie menunjuk id tak ada → found:false (server harus lepas cookie)
        data = await recoverByCookie(999999);
        assert.strictEqual(data.found, false);
        ok('Cookie id tak ada → {found:false}');

        // A4. Antrian canceled via client → cookie ter-clear, recover jadi false
        await axios.post(`${BASE_URL}/queue/cancel`, { id: take.data.id, studio_location: STUDIO });
        data = await recoverByCookie(take.data.id);
        assert.strictEqual(data.found, false);
        ok('Setelah cancel → cookie invalid, {found:false}');

        // ==== LAPIS B: DEVICE_ID ====
        console.log('\n--- Lapis B: recovery via Device ID ---');

        const devId = 'dev-fixed-42';
        const takeB = await axios.post(`${BASE_URL}/queue`, {
            name: 'Bagas Putra', studio_location: STUDIO, sessions: 1, device_id: devId
        });
        const devRes = await axios.get(`${BASE_URL}/queue/device/${devId}`);
        assert.strictEqual(devRes.data.found, true);
        assert.strictEqual(devRes.data.queue.id, takeB.data.id);
        ok('Device ID sama → antrian milik device direstore');

        const devRes2 = await axios.get(`${BASE_URL}/queue/device/dev-tiada`);
        assert.strictEqual(devRes2.data.found, false);
        ok('Device ID tak dikenal → {found:false}');

        // ==== LAPIS C: NAMA ====
        console.log('\n--- Lapis C: recovery via Nama ---');

        // C1. Nama presisi, case-insensitive
        const takeC = await axios.post(`${BASE_URL}/queue`, {
            name: 'Sasa Riyadi', studio_location: STUDIO, sessions: 1
        });
        data = await recoverByName({ name: 'sasa riyadi', studio_location: STUDIO });
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.queue.id, takeC.data.id);
        assert.strictEqual(data.queue.status, 'waiting');
        ok('Nama dicocokkan case-insensitive → antrian direstore');

        // C2. Nama salah → success:false
        data = await recoverByName({ name: 'tidak ada', studio_location: STUDIO });
        assert.strictEqual(data.success, false);
        ok('Nama tak cocok → {success:false}');

        // C3. Antrian di lokasi lain tetap ketemu (fallback lintas lokasi)
        data = await recoverByName({ name: 'sasa riyadi', studio_location: 'Youth Center' });
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.queue.studio_location, STUDIO);
        ok('Nama antrian di lokasi lain → ketemu via fallback lintas lokasi');

        // ==== INTEGRITAS STATS (tidak ada yang korup setelah recover) ====
        console.log('\n--- Integritas Setelah Test ---');
        await axios.post(`${BASE_URL}/queue/cancel`, { id: takeC.data.id, studio_location: STUDIO });
        await axios.post(`${BASE_URL}/queue/cancel`, { id: takeB.data.id, studio_location: STUDIO });
        const stats = (await axios.get(`${BASE_URL}/stats/${STUDIO}`)).data;
        assert.strictEqual(stats.waiting, 0);
        ok('Semua antrian tes dibersihkan, waiting=0');

        console.log(`\n🎉 RECOVERY TESTING BERHASIL — pass=${passed} fail=${failed}`);
        process.exit(failed ? 1 : 0);

    } catch (e) {
        failed++;
        console.error('❌ PENGUJIAN GAGAL:', e.response ? e.response.data : e.message);
        process.exit(1);
    }
}

runTests();