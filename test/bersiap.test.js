const assert = require('assert');
const { getBersiapCandidate } = require('../src/services/bersiap');

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function bad(name, err) { failed++; console.error(`  ❌ ${name}: ${err}`); }

// Mock pool: meniru perilaku SQL untuk SELECT queues
// (filter status waiting/called, urut id ASC, lewati 2, ambil 1),
// sekaligus menangkap SQL + params yang dikirim service.
function mockPool(rows) {
    const state = { lastSql: null, lastParams: null };
    state.query = async (sql, params) => {
        state.lastSql = sql;
        state.lastParams = params;
        if (!/^SELECT \* FROM queues/.test(sql)) return [rows];
        const filtered = rows
            .filter(r => r.status === 'waiting' || r.status === 'called')
            .sort((a, b) => a.id - b.id);
        return [filtered.slice(2, 3)];
    };
    return state;
}

async function runTests() {
    console.log("Memulai Unit Testing Fitur Bersiap-Siap...");

    // ==== T1: 3 antrian (called + 2 waiting) → orang ke-3 ====
    console.log('\n--- Pemilihan kandidat bersiap ---');
    try {
        const line = mockPool([
            { id: 1, queue_number: '01', status: 'called' },
            { id: 2, queue_number: '02', status: 'waiting' },
            { id: 3, queue_number: '03', status: 'waiting' }
        ]);
        const cand = await getBersiapCandidate('Studio Utama', line);
        assert.strictEqual(cand.queue_number, '03');
        ok('3 antrian → kandidat = orang ke-3 (sisa 2 orang)');
    } catch (e) { bad('3 antrian → kandidat = orang ke-3', e.message); }

    try {
        const line = mockPool([
            { id: 1, queue_number: '01', status: 'called' },
            { id: 2, queue_number: '02', status: 'waiting' },
            { id: 3, queue_number: '03', status: 'waiting' },
            { id: 4, queue_number: '04', status: 'waiting' },
            { id: 5, queue_number: '05', status: 'waiting' }
        ]);
        const cand = await getBersiapCandidate('Studio Utama', line);
        assert.strictEqual(cand.queue_number, '03');
        ok('5 antrian → tetap orang ke-3, bukan yang paling depan');
    } catch (e) { bad('5 antrian → tetap orang ke-3', e.message); }

    // ==== T2: Kasus tanpa kandidat ====
    console.log('\n--- Tanpa kandidat bersiap ---');
    try {
        const line = mockPool([
            { id: 1, queue_number: '01', status: 'called' },
            { id: 2, queue_number: '02', status: 'waiting' }
        ]);
        const cand = await getBersiapCandidate('Studio Utama', line);
        assert.strictEqual(cand, null);
        ok('Kurang dari 3 → null (tidak ada notifikasi bersiap)');
    } catch (e) { bad('Kurang dari 3 → null', e.message); }

    try {
        const cand = await getBersiapCandidate('Studio Utama', mockPool([]));
        assert.strictEqual(cand, null);
        ok('Antrian kosong → null');
    } catch (e) { bad('Antrian kosong → null', e.message); }

    // ==== T3: SQL yang dikirim ke DB ====
    console.log('\n--- Integritas query SQL ---');
    try {
        const line = mockPool([]);
        await getBersiapCandidate('Studio Utama', line);
        assert.ok(line.lastSql.includes("status IN ('waiting', 'called')"), 'filter status');
        assert.ok(line.lastSql.includes('ORDER BY id ASC'), 'urut by id');
        assert.ok(line.lastSql.includes('LIMIT 1 OFFSET 2'), 'ambil 1 setelah 2 antrian');
        assert.deepStrictEqual(line.lastParams, ['Studio Utama']);
        ok('SQL: hanya waiting/called, order by id, LIMIT 1 OFFSET 2, param lokasi benar');
    } catch (e) { bad('SQL salah', e.message); }

    // done/cancelled tidak pernah jadi kandidat — filter ada di SQL
    try {
        const line = mockPool([]);
        await getBersiapCandidate('Studio Utama', line);
        assert.ok(!line.lastSql.includes('done') || line.lastSql.includes("status IN ('waiting', 'called')"), 'done/cancelled terfilter');
        ok('done/cancelled terfilter (status IN waiting/called)');
    } catch (e) { bad('done/cancelled terfilter', e.message); }

    // ==== T4: Isolasi lokasi ====
    console.log('\n--- Isolasi lokasi ---');
    try {
        const line = mockPool([]);
        await getBersiapCandidate('Youth Center', line);
        assert.deepStrictEqual(line.lastParams, ['Youth Center']);
        assert.ok(line.lastSql.includes('studio_location = ?'));
        ok('Query per lokasi (Youth Center tidak bercampur Studio Utama)');
    } catch (e) { bad('Isolasi lokasi', e.message); }

    console.log(`\n🎉 BERSIAP-SIAP UNIT TESTING BERHASIL — pass=${passed} fail=${failed}`);
    process.exit(failed ? 1 : 0);
}

runTests();
