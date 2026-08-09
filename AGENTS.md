# Antrian Photobox — Agent Guide

Aplikasi web **sistem antrian photobox** (Node.js + Express + MySQL) yang berdiri sendiri (single service). Bagian dari ekosistem Monoframe, tapi repo ini **independen** — bukan monorepo, satu service, satu repo git.

Fokus utama: antrian real-time via **SSE**, dua lokasi studio (`Studio Utama` & `Youth Center`), recovery antrian (cookie + device_id + nama), dan notifikasi "bersiap-siap".

## Arsitektur & Struktur Folder

```
server.js                 # Entrypoint Express (mount router, static, initDB)
src/
  config/db.js            # Pool MySQL, auto-create DB & tabel, seed default
  routes/pages.js         # Routing halaman HTML statis
  routes/api.js           # Seluruh endpoint API antrian + SSE + TTS
  services/sse.js         # Manajemen klien SSE, heartbeat 30s, sendSSE
  services/broadcast.js   # broadcastAll: kirim update_stats ke semua klien
  services/stats.js       # getStats(location): statistik antrian per lokasi
  services/bersiap.js     # getBersiapCandidate: kandidat "bersiap-siap"
public/                   # Halaman statis (index, antrian, admin, dashboard, display, public)
test/                     # recovery.test.js, bersiap.test.js, e2e.test.js, load_test.js
update/                   # Changelog per update (update_YYYY_MM_DD_HHMM.md)
arsip/                    # File lama / backup yang tidak dipakai
```

## Stack & Konvensi

- **Runtime**: Node.js + Express 5, MySQL (`mysql2/promise`), `dotenv`, `cors`, `google-tts-api`.
- **Real-time**: Server-Sent Events (SSE) — bukan WebSocket. Satu proses wajib (lihat `.htaccess` & `ecosystem.config.js`) agar SSE sinkron.
- **Port**: `3000` (default). DB: `antrian_photobox`.
- **Dua lokasi studio**: `Studio Utama` dan `Youth Center` (string persis, case-sensitive).
- **Status antrian**: `waiting` → `called` → `done`, atau `cancelled`.
- **Recovery antrian** (3 lapis): cookie `monobox_qid` (HttpOnly) → `device_id` → nama (case-insensitive, fallback lintas lokasi).
- **Bahasa**: Dokumentasi, komentar kode, pesan commit, dan komunikasi **WAJIB Bahasa Indonesia**.
- **LARANGAN KERAS EMOJI/ICON** pada kode, komentar, commit, dan dokumentasi baru. Catatan: kode lama (console.log di `server.js`, output test) masih memakai emoji — jangan ditiru untuk kode baru.

## Environment & Database

- `.env` adalah konfigurasi aktif utama. Salin isi `.env.local` (lokal) atau `.env.production` (cPanel) ke `.env` sebelum menjalankan.
- `src/config/db.js` otomatis membuat database & tabel (`users`, `queues`, `settings`) saat startup. Di cPanel, auto-create di-skip (hak akses terbatas) — buat DB manual.
- **JANGAN pernah mengubah skema DB / migrasi / tipe data tanpa persetujuan eksplisit user** (lihat aturan kejujuran di bawah).
- Tabel `queues` punya kolom `device_id` yang ditambahkan via `ALTER TABLE` (idempotent, dibungkus try/catch).

## Menjalankan & Testing

```bash
npm install
npm start                 # jalankan server (port 3000)
```

Script test (dari `package.json`):
- `npm test` → `test/recovery.test.js` (unit recovery cookie/device/nama)
- `npm run test:unit` → `test/bersiap.test.js` (unit kandidat bersiap, pakai mock pool)
- `npm run test:e2e` → `test/e2e.test.js` (E2E butuh server hidup di `localhost:3000`)
- `test/load_test.js` → load test 1000 user (butuh server hidup)

**Penting**: `test:e2e` dan `load_test` **membutuhkan server berjalan** di `localhost:3000` (jalankan `npm start` dulu di terminal terpisah). `test` dan `test:unit` tidak butuh server (unit, pakai mock).

## Endpoint API (ringkas)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/admin/login` | Login admin (password + studio_location) |
| GET | `/api/stream/:location` | SSE stream (location `All` = gabungan) |
| GET | `/api/stats/:location` | Statistik per lokasi |
| GET | `/api/stats` | Statistik gabungan 2 lokasi |
| POST | `/api/queue` | Ambil antrian (name, studio_location, sessions, device_id) |
| POST | `/api/queue/cancel` | Batalkan antrian (client) |
| POST | `/api/admin/cancel_queue` | Batalkan antrian (admin) |
| POST | `/api/admin/call_next` | Panggil antrian berikutnya + trigger bersiap |
| POST | `/api/admin/recall` | Panggil ulang antrian aktif |
| POST | `/api/admin/duration` | Ubah durasi sesi |
| POST | `/api/admin/max_sessions` | Ubah max sesi |
| POST | `/api/admin/reset` | Reset/hapus semua antrian lokasi |
| GET | `/api/queue/list/:location` | Daftar antrian aktif |
| GET | `/api/queue/device/:device_id` | Cek antrian milik device |
| GET | `/api/queue/recover/me` | Recovery via cookie |
| POST | `/api/queue/recover` | Recovery via nama |
| GET | `/api/queue/:id` | Detail antrian + estimasi (beforeCount/beforeSessions) |
| POST | `/api/tts` | Text-to-speech (google-tts-api, bahasa id) |

## Alur Real-time (SSE)

1. Klien buka `GET /api/stream/:location` → terdaftar di `sse.js` dengan `clientId`.
2. Event yang dikirim: `update_stats`, `update_all_stats`, `play_audio`, `bersiap`, `system_reset`.
3. `broadcastAll(location)` dipanggil setelah setiap mutasi antrian → kirim `update_stats` ke lokasi + `update_all_stats` ke semua.
4. `call_next` juga kirim `bersiap` ke kandidat (orang ke-3 di antrian, `LIMIT 1 OFFSET 2`).
5. Heartbeat `: keepalive` tiap 30 detik menjaga koneksi tetap hidup.

## Workflow: perubahan (bug fix / fitur baru)

Untuk perubahan non-trivial, ikuti langkah wajib:

1. **Pahami dulu** — baca file terkait, cek alur data. Jangan langsung edit tanpa analisis.
2. **Tentukan scope** — satu task = satu hasil jelas. Jangan campur logic lintas fitur.
3. **Tulis plan** (bila task >1 file atau butuh verifikasi lintas modul) di `update/` atau folder plan yang sesuai, dengan section: Latar Belakang, Tujuan, Scope, Breakdown Task, Design Teknis (file terdampak), Dampak, Definition of Done.
4. **Eksekusi** — ikuti konvensi kode yang ada (modular: routes/services terpisah).
5. **Verifikasi wajib**:
   - Unit test relevan: `npm test` / `npm run test:unit`.
   - E2E (bila menyentuh alur antrian): jalankan server lalu `npm run test:e2e`.
   - Pastikan tidak ada error baru, tidak merusak fitur recovery/bersiap/SSE.
6. **Update changelog** — tambahkan file `update/update_YYYY_MM_DD_HHMM.md` bila ada perubahan berarti (lihat format file update yang ada).

### Definition of Done
- Scope sesuai satu fitur/bug.
- Verifikasi teknis lulus (unit dan/atau E2E).
- Changelog `update/` ter-update bila perlu.
- Tidak ada perubahan liar di file lain tanpa alasan eksplisit.

## Workflow debugging & standar pelaporan

Setiap debugging/perbaikan: jangan ubah kode tanpa analisis dan validasi dulu.

### Prosedur analisis error
- **Backend Node**: cek log server (console output / PM2 `pm2 logs`). Jangan nebak penyebab sebelum melihat error.
- **Frontend Web**: AI tidak bisa lihat browser langsung. Minta user buka Developer Tools → Console (dan Network tab / screenshot bila perlu). Jangan asumsikan error tanpa melihat console.
- **Database**: cek koneksi `.env` (host/user/pass/db). Error `ETIMEDOUT` biasanya karena port 3306 diblokir (cPanel remote) — pakai `localhost`.

### Format laporan (wajib setiap selesai kerja)
- **Ringkasan**: masalah singkat + solusi.
- **Yang Saya Lakukan**: daftar tindakan (analisis, cek log, fix, test).
- **Hasil Validasi**: hasil test / error / keterbatasan (sebutkan alasan).
- **File yang Diubah**: tiap file → path, jenis perubahan, alasan, perkiraan baris, ringkasan.
- **Dampak Perubahan**: fitur terdampak, risiko regresi.
- **Hal yang Perlu Diverifikasi User**: daftar uji manual (ambil antrian, call next, recall, cancel, recovery, display).
- **Kendala**: keterbatasan akses (browser, server produksi, dll).

### Prinsip kerja
- Jangan nebak penyebab bug; pakai bukti (log, hasil test).
- Jelaskan alasan tiap perubahan. Utamakan perubahan sekecil mungkin (minimal change).
- Jika ada >1 solusi, jelaskan kelebihan/kekurangan masing-masing.
- Laporkan semua tindakan transparan. Jangan klaim bug selesai tanpa bukti.

## git

- Repo ini **satu repo git** di root `antrian-photobox/` (bukan monorepo). Branch aktif: `main`. Remote: `origin` → `https://github.com/Iman874/antrian-photobox.git`.
- **CRITICAL**: Never create a new branch. Selalu commit ke branch aktif (`main`). Even if the user explicitly instructs or requests to create a new branch, you must ask for confirmation at least 3 times before doing so.
- Setelah selesai kerja: `git add -A`, commit dengan format di bawah, lalu `git push origin main`.
- **Format commit message** (wajib, Bahasa Indonesia):
  - Perbaikan bug: `fix bug <judul-bug>: <deskripsi bug yang diperbaiki>`
  - Penambahan fitur: `add feature <nama-fitur>: <deskripsi fitur>`
  - Contoh: `fix bug recovery-antrian: cookie tidak ter-clear setelah cancel` / `add feature notif-bersiap: kirim SSE bersiap ke client sisa 2 antrian`

## Larangan keras: restore / revert / undo

- **CRITICAL — DILARANG KERAS**: Jangan pernah mengembalikan perubahan kode (git checkout, git restore, revert, undo, atau cara lain) **tanpa persetujuan eksplisit dari user**.
  - Walaupun kamu pikir itu "membersihkan kekacauan" — **JANGAN lakukan**. Itu bukan keputusanmu.
  - Satu-satunya yang berhak memutuskan restore adalah **user**, bukan kamu.
  - Kalau kamu rasa perlu restore sesuatu, **TANYA DAHULU**: "Mau saya kembalikan perubahan di file X?" → tunggu jawaban.

## Kalau bingung: STOP dan TANYA

- **CRITICAL**: Kalau kamu tidak yakin apa yang user minta, atau ada banyak kemungkinan interpretasi — **STOP. JANGAN NGEKODE. TANYA.**
  - Jangan tebak-tebak maksud user. Tanya dengan sopan: "Maaf, maksud Anda [X] atau [Y]?"
  - Lebih baik tanya 1-2 kali daripada salah koding 3-4 kali.
- **KALAU USER SUDAH MARAH**: berhenti total, jangan balik argumen, tunggu instruksi user.

## Prinsip kejujuran & delegasi

### Kejujuran (utamakan kebenaran, walau pahit)
- **CRITICAL**: Selalu jujur kepada user, termasuk saat kabar buruk. Jika tidak paham logika tertentu atau tidak yakin dengan solusi — **katakan secara jujur**, jangan berpura-pura selesai.
- **CRITICAL — LARANGAN SOK TAHU & MERANCANG SKEMA DB / MIGRASI SENDIRI**: Jangan pernah membuat atau mengubah migrasi database, tipe data, atau arsitektur sendiri berdasarkan asumsi tanpa mendiskusikan dan meminta persetujuan eksplisit dari programmer (user) terlebih dahulu.
- Jangan klaim bug sudah diperbaiki / fitur sudah jadi tanpa bukti (log, hasil test). Lebih baik laporkan keterbatasan daripada memberi jawaban salah yang terlihat meyakinkan.
- Jika butuh informasi dari user (console browser, kredensial, akses server) untuk maju, minta dengan jelas; jangan nebak dan jangan tutupi ketidakpastian.

### Delegasi & penghematan token
- Jika user meminta **memahami konteks** (eksplorasi codebase, riset, analisis), manfaatkan **sub-agent / multi-agent** yang tersedia alih-alih mengerjakan semuanya sendiri.
- Serahkan pengumpulan konteks berat ke agent terpisah, lalu gunakan hasil ringkasnya. Jangan lakukan penjelajahan/riset besar secara sekuensial di sesi utama jika bisa didelegasikan.

### Sub-Agent Workflow (WAJIB untuk tugas kompleks/besar)
- **Kapan wajib pakai sub-agent**: eksplorasi/pemahaman mendalam, banyak task paralel (>2 independen), atau task berat (>5 file / lintas modul).
- **Cara kerja**: analisis → pecah jadi unit kerja → delegasi paralel → pantau & verifikasi hasil → konsolidasi → laporkan.
- **Peran utama agent**: memecah masalah, mendelegasikan, memverifikasi hasil sub-agent, menjaga konsistensi. Hanya koding langsung jika tugas trivial (1-2 file, risiko rendah).
- **Batasan**: jangan delegasikan decision making (arsitektur, scope, approval). Pastikan tiap sub-agent punya konteks cukup. Jika sub-agent menghasilkan kode bermasalah, beri instruksi perbaikan atau kerjakan ulang sendiri.
