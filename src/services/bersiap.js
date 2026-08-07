const { pool } = require('../config/db');

// Kandidat "bersiap-siap": client dengan sisa 2 orang di depan (orang ke-3 di antrian).
// Posisi 0 = sedang dipanggil, 1 = penunggu berikutnya, 2 = bersiap.
// Hanya status 'waiting'/'called' yang dihitung (done/cancelled dilewati).
async function getBersiapCandidate(studio_location, queryable = pool) {
    const [rows] = await queryable.query(
        "SELECT * FROM queues WHERE studio_location = ? AND status IN ('waiting', 'called') ORDER BY id ASC LIMIT 1 OFFSET 2",
        [studio_location]
    );
    return rows.length > 0 ? rows[0] : null;
}

module.exports = {
    getBersiapCandidate
};
