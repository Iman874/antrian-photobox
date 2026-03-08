const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

const STUDIO_UTAMA = 'Studio Utama';
const YOUTH_CENTER = 'Youth Center';

const namesDummy = [
    'Ahmad', 'Budi', 'Citra', 'Dimas', 'Eka', 
    'Fahmi', 'Gita', 'Hadi', 'Irfan', 'Joko', 
    'Kiki', 'Lestari', 'Maya', 'Nia', 'Oki'
];

async function generateDummyClients() {
    console.log("Membuat Dummy Data Antrian...");

    try {
        // Reset kedua lokasi terlebih dahulu agar bersih
        await axios.post(`${BASE_URL}/admin/reset`, { studio_location: STUDIO_UTAMA });
        await axios.post(`${BASE_URL}/admin/reset`, { studio_location: YOUTH_CENTER });
        console.log("✅ Sistem di-reset.");

        console.log(`\n⏳ Menambahkan 10 Client ke [${STUDIO_UTAMA}]...`);
        for (let i = 0; i < 10; i++) {
            await axios.post(`${BASE_URL}/queue`, { 
                name: namesDummy[i], 
                studio_location: STUDIO_UTAMA 
            });
            console.log(`   + Client '${namesDummy[i]}' berhasi masuk ke Studio Utama`);
        }

        console.log(`\n⏳ Menambahkan 5 Client ke [${YOUTH_CENTER}]...`);
        for (let i = 10; i < 15; i++) {
            await axios.post(`${BASE_URL}/queue`, { 
                name: namesDummy[i], 
                studio_location: YOUTH_CENTER 
            });
            console.log(`   + Client '${namesDummy[i]}' berhasi masuk ke Youth Center`);
        }

        console.log("\n🎉 Proses generate 15 Dummy Berhasil!");
        console.log("Silakan cek browser Anda di halaman Display / Admin Dashboard, data dan waiting list sudah terisi.");
        
    } catch (e) {
        console.error("❌ Gagal membuat dummy data:", e.response ? e.response.data : e.message);
    }
}

generateDummyClients();
