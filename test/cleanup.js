const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://antrian.photobox.monogroup.cloud/api';
const LOCATIONS = ['Studio Utama', 'Youth Center'];

async function run() {
    console.log(`Membersihkan data antrian di ${BASE_URL}`);
    for (const loc of LOCATIONS) {
        try {
            const res = await axios.post(`${BASE_URL}/admin/reset`, { studio_location: loc });
            console.log(`  ${loc}: ${res.data.success ? 'bersih' : 'gagal'}`);
        } catch (e) {
            console.log(`  ${loc}: error ${e.response ? e.response.status : e.message}`);
        }
    }
    console.log('Selesai.');
    process.exit(0);
}

run();
