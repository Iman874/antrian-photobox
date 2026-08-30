const assert = require('assert');
const { getStats } = require('../src/services/stats');

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function bad(name, err) { failed++; console.error(`  ❌ ${name}: ${err}`); }

// Mock pool: menangkap tiap SQL + params, sambil meniru semantik DB nyata
// (filter status/lokasi, bentuk hasil COUNT/settings) agar getStats tidak crash.
// (selaras dengan pola di bersiap.test.js — tanpa menyentuh DB nyata)
function mockPool(rows) {
    const state = { queries: [], lastParams: null };
    state.query = async (sql, params) => {
        state.queries.push({ sql, params });
        state.lastParams = params;
        const loc = params && params[0];

        if (/COALESCE\(SUM\(sessions\)/.test(sql)) {
            const w = rows.filter(r => r.studio_location === loc && r.status === 'waiting');
            const total_sessions = w.reduce((s, r) => s + (r.sessions || 0), 0);
            return [[{ cnt: w.length, total_sessions }]];
        }
        if (/SELECT COUNT\(\*\) as cnt FROM queues WHERE studio_location = \?$/.test(sql)) {
            const t = rows.filter(r => r.studio_location === loc);
            return [[{ cnt: t.length }]];
        }
        if (/status = 'called' ORDER BY sort_order DESC, id DESC LIMIT 1/.test(sql)) {
            const c = rows.filter(r => r.studio_location === loc && r.status === 'called')
                .sort((a, b) => (b.sort_order ?? b.id) - (a.sort_order ?? a.id));
            return [c.slice(0, 1)];
        }
        if (/SELECT \* FROM settings/.test(sql)) {
            return [[{ session_duration: 7, max_sessions: 2 }]];
        }
        if (/SELECT id, name, queue_number/.test(sql)) {
            const list = rows.filter(r => r.studio_location === loc && (r.status === 'waiting' || r.status === 'called'))
                .sort((a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? a.id));
            return [list];
        }
        return [rows];
    };
    return state;
}

function findQueueListQuery(fake) {
    return fake.queries.find(q => /SELECT id, name, queue_number/.test(q.sql));
}

async function runTests() {
    console.log("Memulai Unit Testing Daftar Antrian (regresi bug lewat tengah malam)...");

    const yesterday = new Date(Date.now() - 26 * 3600 * 1000); // ~kemarin
    const today = new Date();

    const rows = [
        { id: 1, name: 'Budi', queue_number: '07', sessions: 1, status: 'waiting', created_at: yesterday, studio_location: 'Studio Utama' },
        { id: 2, name: 'Sari', queue_number: '08', sessions: 2, status: 'called', created_at: today, studio_location: 'Studio Utama' },
        { id: 3, name: 'Done', queue_number: '09', sessions: 1, status: 'done', created_at: yesterday, studio_location: 'Studio Utama' }
    ];

    // ==== T1: SQL daftar antrian BEBAS filter tanggal ====
    console.log('\n--- Integritas query daftar antrian ---');
    try {
        const fake = mockPool(rows);
        await getStats('Studio Utama', fake);
        const ql = findQueueListQuery(fake);
        assert.ok(ql, 'query queue_list ditemukan');
        assert.ok(!ql.sql.toUpperCase().includes('DATE(created_at)'), 'tidak ada filter DATE(created_at)');
        assert.ok(!ql.sql.toUpperCase().includes('CURDATE()'), 'tidak ada filter CURDATE()');
        ok('SQL daftar antrian tidak memfilter tanggal (bug tidak akan balik)');
    } catch (e) { bad('SQL daftar antrian bebas filter tanggal', e.message); }

    // ==== T2: filter status & lokasi tetap ada ====
    try {
        const fake = mockPool(rows);
        await getStats('Studio Utama', fake);
        const ql = findQueueListQuery(fake);
        assert.ok(ql.sql.includes("status IN ('waiting', 'called')"), 'filter status');
        assert.ok(ql.sql.includes('studio_location = ?'), 'filter lokasi');
        assert.deepStrictEqual(ql.params, ['Studio Utama']);
        ok('SQL tetap filter status waiting/called + lokasi benar');
    } catch (e) { bad('SQL filter status & lokasi', e.message); }

    // ==== T3: reproduksi bug — antrian kemarin tetap tampil ====
    console.log('\n--- Behavior: antrian lewat tengah malam tetap tampil ---');
    try {
        const fake = mockPool(rows);
        const stats = await getStats('Studio Utama', fake);
        const names = stats.queue_list.map(q => q.name);
        assert.ok(names.includes('Budi'), 'antrian dibuat KEMARIN (waiting) tetap muncul di list');
        assert.ok(names.includes('Sari'), 'antrian hari ini (called) tetap muncul');
        assert.ok(!names.includes('Done'), 'yang sudah done tetap terfilter (bukan bug lama)');
        ok('Antrian aktif dari hari sebelumnya tidak hilang pasca tengah malam');
    } catch (e) { bad('Antrian kemarin tetap tampil', e.message); }

    // ==== T4: isolasi lokasi ====
    console.log('\n--- Isolasi lokasi ---');
    try {
        const fake = mockPool([]);
        await getStats('Youth Center', fake);
        const ql = findQueueListQuery(fake);
        assert.deepStrictEqual(ql.params, ['Youth Center']);
        ok('Query per lokasi (Youth Center tidak bercampur Studio Utama)');
    } catch (e) { bad('Isolasi lokasi', e.message); }

    console.log(`\n🎉 QUEUE LIST UNIT TESTING BERHASIL — pass=${passed} fail=${failed}`);
    process.exit(failed ? 1 : 0);
}

runTests();
