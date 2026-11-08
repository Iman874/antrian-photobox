# How To Deploy — Antrian Photobox (Node.js + Express + MySQL/MariaDB)

Panduan deploy production ke VPS Linux: sekali jalan lewat `deploy.sh`, atau manual langkah per langkah. Dokumen ini juga memuat gotcha yang terbukti dari isi repo ini supaya tidak terulang.

Domain produksi: `antrian.photobox.monoframe.id`
Dokumen: diperbarui 2026-11-08. Perintah di blok `bash` dijalankan sebagai `root` DI SERVER, kecuali ditulis "dari laptop".

---

## 0. Rekomendasi target dan alasan

| Kandidat | IP | Sudah ada di box | Rekomendasi |
|---|---|---|---|
| VPS 2 idcloudhost | `103.123.62.39` | nginx + certbot, MariaDB, Laravel `backend_v3`, pola path `/var/www/monobox/` | **Dipakai** (default dokumen dan skrip) |
| VPS 1 Rumahweb (host `monodev`) | `203.194.115.85` | backend produksi kios, admin, AI Service port 4000 | Hanya kalau VPS 2 tidak bisa dipakai |

Alasan: aplikasi ini service mandiri (DB sendiri, tidak memanggil backend kios). Menaruhnya di box produksi menambah radius kegagalan ke trafik kios yang membayar — proses Node tunggal dengan koneksi SSE jangka panjang, plus potensi restart-loop kalau DB belum siap. VPS 2 sudah punya nginx, certbot, MariaDB, dan pola folder yang sama, jadi tidak ada instalasi sistem baru.

Syarat di VPS 2: jangan pakai nama DB yang sudah ada di sana (`photobox_deploytest`, `monf3757_photobox_v3`) dan jangan mengubah vhost nginx yang sudah aktif.

Kalau jadi pindah ke VPS 1, yang berubah hanya IP target dan cek tabrakan port (bagian 3). Sisanya identik.

| Item | Nilai |
|---|---|
| SSH | `ssh root@103.123.62.39` (VPS 2 idcloudhost). Jangan pakai alias `monodev` di dokumen ini: alias itu milik VPS 1 Rumahweb |
| App root | `/var/www/monobox/antrian-photobox` |
| Public root (Express static) | `<APP_DIR>/public` |
| Port Node | `3000` |
| Database | `monf3757_antrian_photobox` (user sama; nama ini yang sudah ada di `.env.production`, jadi env tidak perlu diedit di server) |
| Process manager | PM2, 1 instance, fork mode |
| Nginx site | `/etc/nginx/sites-available/antrian.photobox.monoframe.id` |
| Node.js | minimal 18; yang dipasang di sini Node 20 LTS |

Tiga hal yang wajib dipahami sebelum eksekusi:

- **Satu proses saja.** Real-time memakai SSE dan daftar klien hidup di memori proses (`src/services/sse.js`). Dua instance berarti sebagian layar tidak menerima broadcast. Jangan `--instances`, jangan `exec_mode: cluster`.
- **Aplikasi membaca `.env`, bukan `.env.production`.** `server.js` dan `src/config/db.js` memanggil `require('dotenv').config()` tanpa path, jadi hanya file bernama `.env` di root app yang dimuat.
- **Tidak ada langkah build.** `public/` disajikan langsung oleh Express (`express.static`), dan halaman memakai path API relatif (terverifikasi: tidak ada URL host hardcoded di `public/*.html`). Tidak ada `npm run build`.

---

## 1. Cara SSH ke VPS

```bash
ssh root@103.123.62.39        # VPS 2 idcloudhost, target dokumen ini
```

> Alias `monodev` di laptop menunjuk ke VPS 1 Rumahweb (`203.194.115.85`), yaitu box produksi kios. Jangan memakai alias itu untuk langkah-langkah di dokumen ini; semua perintah di bawah menganggap mesin yang dituju adalah `103.123.62.39`.

Koneksi pertama menanyakan fingerprint host, ketik `yes`. Login tanpa password (sekali saja):

```bash
# dari laptop
ssh-keygen -t ed25519 -C "antrian-deploy"
ssh-copy-id root@103.123.62.39
# Windows tanpa ssh-copy-id: salin isi ~/.ssh/id_ed25519.pub ke ~/.ssh/authorized_keys di server
```

Setelah masuk: `whoami` harus `root`.

---

## 2. Deploy sekali jalan dengan `deploy.sh`

Skrip `deploy.sh` ada di root repo ini, **dijalankan di server dari dalam folder app**, dan mendeteksi foldernya sendiri sebagai `APP_DIR`. Ia tidak melakukan SSH keluar: mesin tempat ia dijalankan dianggap target.

### 2.1 Kirim kode ke server (dari laptop)

Opsi A, kirim folder repo apa adanya (`.git` ikut, jadi update berikutnya `git pull` jalan):

```bash
ssh root@103.123.62.39 "mkdir -p /var/www/monobox"
scp -r D:/Iman874/Documents/Github/antrian-photobox root@103.123.62.39:/var/www/monobox/
```

Opsi B, kirim skripnya saja dan biarkan skrip men-clone dirinya sendiri (bootstrap `git init` + fetch). Ini jalan karena satu-satunya berkas di folder itu adalah `deploy.sh`:

```bash
ssh root@103.123.62.39 "mkdir -p /var/www/monobox/antrian-photobox"
scp D:/Iman874/Documents/Github/antrian-photobox/deploy.sh root@103.123.62.39:/var/www/monobox/antrian-photobox/
```

Env tidak perlu dikirim terpisah: `ENV_SRC` bawaan skrip adalah `<APP_DIR>/.env.production`, dan file itu ikut terkirim atau ter-clone karena ter-commit di repo. Kirim ulang hanya kalau `DB_PASS` lokal mau mengganti yang di server:

```bash
scp D:/Iman874/Documents/Github/antrian-photobox/.env.production root@103.123.62.39:/var/www/monobox/antrian-photobox/.env.production
```

Kalau `DB_PASS` di `.env.production` masih berisi kredensial cPanel lama, ganti dulu nilainya dengan password MariaDB yang dipakai di server ini (lihat gotcha 1 soal kredensial yang sudah ter-commit).

### 2.2 Baca kondisi server dulu (tidak menulis apa pun)

```bash
ssh root@103.123.62.39
cd /var/www/monobox/antrian-photobox
bash deploy.sh --check
```

`--check` menampilkan versi node, pm2, nginx, mysql, apakah port 3000 bebas, apakah vhost dan sertifikat sudah ada, plus IP box. Baris `App dir` dan `.env produksi` dihitung dari folder tempat skrip berada, jadi pastikan `pwd`-nya benar. Semua yang belum ada akan dipasang pada langkah berikutnya.

### 2.3 Jalankan deploy penuh

```bash
cd /var/www/monobox/antrian-photobox
SSL_EMAIL=rosuliman874@gmail.com bash deploy.sh
```

Yang dilakukan skrip, berurutan: pasang paket yang belum ada (nginx, certbot, ufw, Node 20, PM2 global, client MariaDB) lalu clone `main` ke `APP_DIR` (repo privat: ganti `REPO_URL` ke bentuk SSH) lalu salin `ENV_SRC` ke `<APP_DIR>/.env` (versi lama dicadang `.env.bak-<timestamp>`) lalu buat DB, user, dan grant `@localhost` plus `@127.0.0.1`, uji koneksi TCP lalu `npm ci --omit=dev` lalu `pm2 start ecosystem.config.js --env production` dan `pm2 save` lalu tulis vhost nginx khusus domain ini (file lama dicadang, `nginx -t` harus lulus sebelum reload) lalu certbot dengan redirect HTTPS lalu verifikasi dengan curl.

Bentuk lain:

```bash
bash deploy.sh --minimal              # update rutin: pull + npm ci + pm2 restart
bash deploy.sh --no-ssl               # deploy penuh, HTTPS nanti
bash deploy.sh --no-nginx --no-db     # hanya app, nginx dan DB disentuh manual
bash deploy.sh --reset-db-password    # paksa password user DB disamakan dengan .env
bash deploy.sh --help                 # daftar flag dan berkas yang ditulis
```

Variabel yang bisa di-override: `APP_DIR REPO_URL GIT_BRANCH DOMAIN PORT DB_NAME DB_USER ENV_SRC SSL_EMAIL`. Contoh pakai port lain:

```bash
PORT=3010 bash deploy.sh --check
```

Kode keluar: `0` sukses, `1` error fatal, `2` argumen tidak dikenal, `3` prasyarat kurang, `4` working tree app kotor (pakai `--allow-dirty` untuk tetap jalan).

`SSL_EMAIL` sebaiknya diisi (misal `rosuliman874@gmail.com`) supaya certbot mencatat email untuk notifikasi expiry. Tanpa itu skrip memakai `--no-eff-email`.

Line ending: `.sh` wajib LF. `.gitattributes` sudah ditambah `*.sh text eol=lf` supaya checkout di Windows tidak mengubahnya jadi CRLF (CRLF membuat bash gagal dengan `$'\r': command not found`).

---

## 3. Cek port dan proses yang sudah berjalan

```bash
ss -ltnp | grep ':3000' || echo "port 3000 bebas"
grep -rn "server_name" /etc/nginx/sites-enabled/
```

Kalau port 3000 sudah dipakai layanan lain, pakai port lain (misal `3010`) dan ganti di **dua** tempat:

1. `ecosystem.config.js` bagian `env_production.PORT` (dan `env.PORT` untuk lokal).
2. `proxy_pass` di vhost nginx (bagian 8).

Catatan yang sering menjebak: `PORT` yang diset PM2 lewat `ecosystem.config.js` **menang** atas nilai di `.env`, karena dotenv tidak menimpa variabel yang sudah ada di environment. Mengubah `PORT` di `.env` saja tidak berpengaruh.

---

## 4. Setup server manual (sekali saja)

```bash
apt update && apt upgrade -y
apt install -y curl git ufw nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v

# PM2 harus global: di package.json, pm2 tercatat di devDependencies,
# jadi npm ci --omit=dev tidak memasangnya.
npm install -g pm2
pm2 -v

# MariaDB (lewati kalau sudah jalan)
apt install -y mariadb-server
systemctl enable --now mariadb
```

---

## 5. Database manual

```bash
mysql
```

```sql
CREATE DATABASE IF NOT EXISTS monf3757_antrian_photobox
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'monf3757_antrian_photobox'@'localhost'
  IDENTIFIED BY 'GANTI_WITH_PASSWORD_KUAT';
CREATE USER IF NOT EXISTS 'monf3757_antrian_photobox'@'127.0.0.1'
  IDENTIFIED BY 'GANTI_WITH_PASSWORD_KUAT';

GRANT ALL PRIVILEGES ON monf3757_antrian_photobox.* TO 'monf3757_antrian_photobox'@'localhost';
GRANT ALL PRIVILEGES ON monf3757_antrian_photobox.* TO 'monf3757_antrian_photobox'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Dua host (`localhost` dan `127.0.0.1`) wajib dibuat. Koneksi `mysql2` ke `host: 'localhost'` tetap koneksi TCP, jadi hak akses dicocokkan dari hasil resolusi alamat; di box ini grant yang terbukti terpakai untuk koneksi aplikasi adalah `@127.0.0.1`. Bila satu host tidak di-grant, startup mati dengan `Access denied for user`.

Uji dari sisi server memakai kredensial yang sama seperti di `.env`:

```bash
mysql -h 127.0.0.1 -u monf3757_antrian_photobox -p monf3757_antrian_photobox -e "SELECT 1"
```

Soal tabel: **tidak ada migrasi manual.** `initDB()` di `src/config/db.js` membuat tabel `users`, `queues`, `settings` plus seed bawaan saat aplikasi pertama start. Jangan menulis skema sendiri dan jangan mengubah tipe data — kalau skema menyimpang, jalur recovery dan bersiap bisa tidak cocok lagi.

Kalau ini migrasi dari cPanel dan data antrian lama harus ikut, dump-restore dilakukan sebelum aplikasi pertama start:

```bash
# dari laptop
mysqldump -h <host_lama> -u <user_lama> -p antrian_photobox > /tmp/antrian_dump.sql
scp /tmp/antrian_dump.sql root@103.123.62.39:/tmp/

# di server
mysql -u root monf3757_antrian_photobox < /tmp/antrian_dump.sql
```

---

## 6. Ambil kode dan pasang `.env` manual

Rekomendasi git, karena update berikutnya cukup `git pull`:

```bash
mkdir -p /var/www/monobox/antrian-photobox
cd /var/www/monobox/antrian-photobox
git init
git remote add origin https://github.com/Iman874/antrian-photobox.git
git fetch origin main
git checkout -B main FETCH_HEAD
```

Repo privat: gunakan `git@github.com:Iman874/antrian-photobox.git` dan pasang deploy key. Tanpa git:

```bash
# dari laptop; folder /var/www/monobox harus sudah ada
scp -r D:/Iman874/Documents/Github/antrian-photobox root@103.123.62.39:/var/www/monobox/
```

Env produksi. Acuan isinya `.env.production` lokal: `NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`. Nilai `DB_PASS` diganti dengan password yang dibuat di bagian 5; password tidak ditulis di dokumen ini.

```bash
# dari laptop: nama file tujuan harus .env, bukan .env.production
scp D:/Iman874/Documents/Github/antrian-photobox/.env.production root@103.123.62.39:/var/www/monobox/antrian-photobox/.env
```

Atau di server kalau `.env.production` sudah ikut ter-clone:

```bash
cd /var/www/monobox/antrian-photobox
cp .env.production .env
nano .env
```

`DB_HOST` harus `localhost` (MySQL/MariaDB di server yang sama). Jangan pakai IP remote: port 3306 tidak dibuka ke publik.

File `.htaccess` (`PassengerMinInstances` / `PassengerMaxPoolSize`) hanya berlaku di cPanel plus Passenger. Di nginx dan PM2 file itu diabaikan; biarkan saja dan jangan menjadikannya bukti jumlah proses.

Dependency:

```bash
cd /var/www/monobox/antrian-photobox
npm ci --omit=dev
```

`npm ci` memakai `package-lock.json` yang sudah ada, jadi versi paket identik dengan yang diuji lokal.

---

## 7. PM2

```bash
cd /var/www/monobox/antrian-photobox
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

`--env production` penting: `env_production` di `ecosystem.config.js` berisi `NODE_ENV=production` dan `PORT=3000`. Tanpa flag itu proses jalan dengan `NODE_ENV=development`.

`ecosystem.config.js` sudah berisi `name: 'antrian-photobox'`, `instances: 1`, `exec_mode: 'fork'`, `autorestart: true`, `watch: false`, `max_memory_restart: '500M'`. Pertahankan nilai itu, jangan diubah menjadi cluster.

Perintah harian:

```bash
pm2 status
pm2 describe antrian-photobox          # cek jumlah restart
pm2 logs antrian-photobox --lines 50
pm2 restart antrian-photobox --update-env
pm2 save
```

Startup yang sehat mencetak `[DB] Mode: PRODUCTION (cPanel)`, `[DB] Host: localhost | Database: monf3757_antrian_photobox`, `Database initialized.`, lalu banner `Server Antrian Monobox Ready`. Label `cPanel` di log hanya teks, mode VPS memakai label yang sama.

---

## 8. Nginx untuk SSE dan SSL

Buat `/etc/nginx/sites-available/antrian.photobox.monoframe.id`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name antrian.photobox.monoframe.id;

    access_log /var/log/nginx/antrian.photobox.monoframe.id.access.log;
    error_log  /var/log/nginx/antrian.photobox.monoframe.id.error.log;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: jangan pakai "Connection upgrade" (itu pola WebSocket).
        # Untuk event-stream Connection dikosongkan supaya request biasa
        # tidak ikut membawa header upgrade.
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        gzip off;

        # Harus lebih panjang dari heartbeat 30 detik aplikasi (src/services/sse.js).
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

Aktifkan dan pasang SSL:

```bash
ln -s /etc/nginx/sites-available/antrian.photobox.monoframe.id /etc/nginx/sites-enabled/
grep -rn "server_name" /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

certbot --nginx -d antrian.photobox.monoframe.id
certbot renew --dry-run
```

`grep server_name` sebelum `nginx -t` bukan formalitas: kalau ada vhost lain dengan `server_name` sama, nginx menolak reload karena *conflicting server name*. Daftar vhost yang benar-benar ada terbaca dari grep itu (catatan proyek September menyebut `dash.monodev.id` dan `backend.monodev.id` di box ini, tapi jangan mengutipnya tanpa melihat hasil grep). Jangan menimpa atau menonaktifkan salah satu vhost yang sudah ada.

Certbot menambahkan `listen 443` dan redirect 80 ke 443. HTTPS bukan pilihan: halaman memakai Notification API dan SSE, dan keduanya tidak berjalan di browser modern lewat HTTP biasa.

---

## 9. Firewall

`server.listen(PORT)` tanpa alamat bind membuat Express mendengarkan semua interface, jadi port 3000 ikut terbuka ke internet dan bisa diakses langsung, melewati nginx dan HTTPS. Tutup:

```bash
ufw status numbers          # baca aturan yang sudah ada sebelum menambah
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 3000/tcp
ufw enable
```

Jangan buka 3306 ke publik. Catatan proyek pernah menuliskan ada `listen 8080` scaffolding di vhost box ini yang kemudian dihapus; verifikasi kenyataannya lewat `ufw status numbers` dan `ss -ltnp`, jangan berasumsi.

Versi lebih rapat (Node hanya mendengarkan `127.0.0.1`) menuntut perubahan `server.js`; tidak dilakukan di dokumen ini karena juga mengubah perilaku saat dikembangkan di Windows.

Tambahan keamanan MySQL yang tetap berlaku: pastikan `bind-address` MariaDB menunjuk `127.0.0.1`, lalu `systemctl restart mariadb`.

---

## 10. Verifikasi setelah deploy

Dari server:

```bash
# 1. proses online dan restart count tidak bertambah
pm2 status

# 2. API lokal menjawab JSON statistik
curl -s "http://127.0.0.1:3000/api/stats/Studio%20Utama"; echo

# 3. lewat domain, harus 200
curl -s -o /dev/null -w "%{http_code}\n" https://antrian.photobox.monoframe.id/

# 4. halaman admin dan display
for p in /monoframe /display/indoor /admin/indoor /indoor/queue; do
  printf "%-16s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://antrian.photobox.monoframe.id$p"
done

# 5. SSE: harus ada event dalam beberapa detik; hentikan dengan Ctrl+C
curl -N "https://antrian.photobox.monoframe.id/api/stream/All"

# 6. unit test MURNI (mock pool, tidak menyentuh DB dan tidak butuh server)
cd /var/www/monobox/antrian-photobox && npm run test:unit
```

> `npm test` dan `npm run test:e2e` **jangan dijalankan di server produksi**. Keduanya menembak `http://localhost:3000` dan memanggil `POST /api/admin/reset` untuk kedua lokasi, jadi antrian customer yang sedang hidup akan terhapus (lihat gotcha 13). Keduanya juga butuh paket `axios` yang tidak terpasang oleh `npm ci --omit=dev`.

Uji manual dari browser (bagian yang tidak bisa dibuktikan dari terminal):

- `https://antrian.photobox.monoframe.id` ambil antrian dengan nama dan lokasi, nomor muncul.
- `/monoframe` login lalu `call_next`: display dan layar klien berubah tanpa refresh. Ini bukti SSE menembus nginx.
- `recall`, `cancel` dari klien, dan recovery (tutup tab, buka lagi, cookie `monobox_qid` atau `device_id` mengembalikan nomor).
- Notifikasi "bersiap-siap" muncul untuk antrian ke-3.
- Suara atau TTS berbunyi (butuh akses keluar ke `translate.google.com`, lihat gotcha 5).
- E2E penuh hanya di DB percobaan: `.env` dengan `DB_NAME` terpisah lalu `npm start` di terminal dan `npm run test:e2e`. Jangan di DB produksi, dan tidak bisa jalan sambil PM2 memegang port 3000.

---

## 11. Update rutin

Paling singkat:

```bash
cd /var/www/monobox/antrian-photobox && bash deploy.sh --minimal
```

Manual, sama hasilnya:

```bash
cd /var/www/monobox/antrian-photobox
git pull origin main
npm ci --omit=dev
pm2 restart antrian-photobox --update-env
```

Satu baris dari laptop:

```bash
ssh root@103.123.62.39 "cd /var/www/monobox/antrian-photobox && git pull origin main && npm ci --omit=dev && pm2 restart antrian-photobox --update-env"
```

Kalau env berubah, kirim ulang lalu restart:

```bash
scp D:/Iman874/Documents/Github/antrian-photobox/.env.production root@103.123.62.39:/var/www/monobox/antrian-photobox/.env
ssh root@103.123.62.39 "pm2 restart antrian-photobox --update-env"
```

Restart memutus semua koneksi SSE; klien reconnect sendiri (halaman punya fallback polling 10 detik), jadi layar tidak perlu disentuh ulang.

---

## 12. Gotcha produksi

Setiap butir punya rujukan ke isi repo ini, bukan dugaan.

**1. `.env`, `.env.local`, dan `.env.production` ter-commit ke GitHub.** `git ls-files` membuktikan ketiganya terlacak, sementara `.gitignore` repo ini hanya memuat `node_modules/`, `.DS_Store`, log, dan beberapa berkas tes — tidak ada baris `.env`. Kredensial DB di dalamnya harus dianggap sudah publik. Yang perlu dikerjakan (keputusan owner, jangan diam-diam): rotasi password DB, tambah `.env` ke `.gitignore`, lalu keluarkan file dari jejak git dengan `git rm --cached`. Riwayat commit tetap menyimpan nilai lama sampai repo di-rewrite.

**2. Seed admin memakai password `admin`, dan barisnya menumpuk setiap restart.** `src/config/db.js` menjalankan `INSERT IGNORE INTO users (...)` untuk `admin1` (Studio Utama) dan `admin2` (Youth Center) setiap start. Tabel `users` tidak punya UNIQUE key pada `username`, jadi `IGNORE` tidak pernah aktif dan dua baris baru masuk tiap proses naik. Login tetap bekerja (`SELECT * FROM users WHERE role='admin' AND studio_location=? AND password=?`), tapi ganti password harus mengenai seluruh baris:

```sql
SELECT id, username, role, studio_location FROM users ORDER BY id;
UPDATE users SET password='PASSWORD_BARU' WHERE role='admin';
SELECT COUNT(*) FROM users;
```

Kalau jumlah baris `users` bertambah tanpa ada yang membuat akun, itu perilaku startup yang normal, bukan tanda ada orang masuk. Perbaikan seed (unique key atau cek jumlah baris) adalah perubahan skema dan wajib dibicarakan lebih dulu.

**3. Dua instance mematikan real-time.** Broadcast SSE hanya mengirim ke klien yang terdaftar di proses yang sama (`src/services/sse.js`). Layar di instance lain tidak berubah sampai polling 10 detik berikutnya. Pertahankan `instances: 1` dan `fork`.

**4. `Connection "upgrade"` untuk SSE itu pola WebSocket** — dan itulah yang dipakai dokumen versi lama. Untuk `text/event-stream` gunakan `proxy_set_header Connection ''` dan `proxy_buffering off` seperti bagian 8. Aplikasi juga mengirim `X-Accel-Buffering: no` di `src/routes/api.js`, tapi set di nginx tetap diperlukan agar tidak bergantung pada satu endpoint.

**5. `/api/tts` butuh akses keluar dari server.** Endpoint memanggil `google-tts-api` dengan host `https://translate.google.com` (`src/routes/api.js`). Kalau egress dibatasi, suara gagal dan response 500 membawa pesan mentah dari library. Cek cepat:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://translate.google.com
```

**6. `Access denied` atau `ECONNREFUSED` saat start membuat PM2 restart-loop.** `initDB()` dipanggil sebelum `listen()` dan kegagalannya hanya `.catch(console.error)`. Ciri di log: baris `[DB]` lalu stack trace tanpa banner `Ready`, dan kolom restarts di `pm2 describe` terus naik. Penyebab tersering: grant host tidak mencakup `127.0.0.1` (bagian 5) atau `DB_HOST` di `.env` menunjuk alamat lain.

**7. `npm ci --omit=dev` tidak memasang PM2.** `pm2` terdaftar di `devDependencies` (`package.json`). PM2 harus global (`npm install -g pm2`) karena itu yang dipanggil `ecosystem.config.js`.

**8. `PORT` di `.env` tidak menang atas `ecosystem.config.js`.** dotenv tidak menimpa variabel yang sudah ada, sementara `env_production` PM2 menyetel `PORT: 3000`. Ganti port di `ecosystem.config.js` dan nginx, bukan di `.env`.

**9. Endpoint admin tidak punya rate limit dan tidak mencatat siapa yang memanggil.** `/api/admin/reset` menghapus antrian satu lokasi. Sebelum menyentuh fitur itu di produksi, backup dulu:

```bash
mysqldump -u root --single-transaction monf3757_antrian_photobox > /root/antrian-backup-$(date +%F-%H%M).sql
```

**10. Cookie recovery `monobox_qid` dikirim tanpa flag `Secure`** (`src/routes/api.js` menyetel `Path`, `HttpOnly`, `Max-Age` saja). Selama nginx me-redirect 80 ke 443 hasil certbot, jalur HTTP hilang dan risikonya kecil. Kalau redirect nanti dilepas, cookie antrian terkirim tanpa enkripsi.

**11. `connectionLimit` pool adalah 20, bukan 10.** Nilainya di `src/config/db.js`; dokumen lama menulis 10 dan itu sudah tertinggal sejak commit `4eaa8da` yang menaikkan pool dari 10 ke 20. Kalau perlu menaikkan lagi, itu keputusan bersama: pool ini berbagi MariaDB dengan layanan lain di box yang sama.

**12. `deploy.sh` menolak jalan kalau working tree app kotor.** Itu sengaja: perubahan lokal di server akan hilang saat `git pull`. Kalau perubahan itu memang mau disimpan, commit dari server atau salin keluar dulu, baru ulangi tanpa `--allow-dirty`.

**13. `test/recovery.test.js` dan `test/e2e.test.js` bukan test aman-produksi.** Keduanya menembak `http://localhost:3000` dan memanggil `POST /api/admin/reset` untuk kedua studio (`await axios.post(\`${BASE_URL}/admin/reset\`, ...)` di awal `recovery.test.js`), jadi data antrian yang sedang hidup dihapus lebih dulu. `AGENTS.md` repo ini menulis `npm test` sebagai unit tanpa server dan itu tidak berlaku lagi untuk kedua file tersebut. Yang benar-benar aman di server hanyalah `npm run test:unit` (`test/bersiap.test.js`, memakai mock pool). Dua file test itu juga bergantung pada `axios`, yang ada di `devDependencies` sehingga tidak terpasang oleh `npm ci --omit=dev`.

**14. Deploy rutin tidak perlu menjalankan test berat.** Cukup `npm run test:unit`; `npm test` dan `npm run test:e2e` baru dipakai di mesin dev dengan DB buangan, sesuai gotcha 13.

**15. `DB_PASS` yang mengandung `#` wajib dikutip di `.env`.** dotenv 16.6.1 memotong nilai tidak dikutip tepat di tanda `#` (terukur: `FAKE12#rest34` terbaca `"FAKE12"`). Karena `initDB()` dijalankan sebelum `listen()` dan kegagalannya hanya `.catch(console.error)`, akibatnya adalah PM2 berstatus online tanpa listener dan nginx membalas 502 — bukan pesan error yang jelas. Perbaikan cepat di server, tanpa perlu menampilkan password:

```bash
sed -i -E 's/^DB_PASS=([^"][^[:space:]]*)[[:space:]]*$/DB_PASS="\1"/' .env
pm2 restart antrian-photobox --update-env
curl -s "http://127.0.0.1:3000/api/stats/Studio%20Utama"; echo
```

`deploy.sh` sekarang mengutip nilai itu sendiri saat menulis `.env`, lalu menolak melanjutkan kalau port aplikasi tidak menjawab 200.

---

## 13. Troubleshooting cepat

| Gejala | Penyebab paling mungkin | Cek dan perbaikan |
|---|---|---|
| `ETIMEDOUT` ke DB | `DB_HOST` bukan `localhost`, port 3306 diblokir | Set `DB_HOST=localhost`, restart PM2 |
| `Access denied for user` | grant tidak mencakup host koneksi | Tambah grant `@127.0.0.1` (bagian 5) |
| Layar tidak update real-time | multi proses, atau buffering nginx | `instances: 1`, `proxy_buffering off`, lalu `curl -N` (bagian 10.5) |
| Event SSE datang tertahan puluhan detik | `proxy_read_timeout` di bawah heartbeat 30s | Naikkan ke 600s, `nginx -t && systemctl reload nginx` |
| 502 Bad Gateway | Node mati atau port tidak sama | `pm2 logs`, cocokkan `proxy_pass` dengan `PORT` |
| Certbot gagal | DNS belum mengarah ke box ini | `nslookup antrian.photobox.monoframe.id 8.8.8.8` |
| `conflicting server name` | vhost lain memakai `server_name` sama | `grep -rn server_name /etc/nginx/sites-enabled/` |
| Tampilan kosong sebagian | browser tidak bisa akses CDN | bukan masalah server; cek `fonts.googleapis.com` dan `cdn.jsdelivr.net` |
| Suara notifikasi gagal | egress ke translate.google.com diblokir | gotcha 5 |
| `$'\r': command not found` | `deploy.sh` tersimpan dengan CRLF | `sed -i 's/\r$//' deploy.sh` |
| Baris `users` terus bertambah | seed tanpa unique key tiap restart | gotcha 2 |

---

## 14. Checklist selesai

- [ ] `pm2 status` online dan `restarts` tidak bertambah.
- [ ] `curl -s http://127.0.0.1:3000/api/stats/Studio%20Utama` mengembalikan JSON.
- [ ] `https://antrian.photobox.monoframe.id` 200 lewat HTTPS, `certbot renew --dry-run` lulus.
- [ ] `curl -N .../api/stream/All` mengalirkan event tanpa buffering.
- [ ] `npm run test:unit` hijau di server (unit murni, tanpa DB).
- [ ] Password admin diganti dan seluruh baris `role='admin'` ikut berubah.
- [ ] Port 3000 tertutup dari publik (`ufw status numbers`).
- [ ] Backup DB pertama tersimpan di `/root/`.
- [ ] Vhost nginx lain di box ini tidak berubah (`nginx -t` sebelum reload).

---

*Dokumen deploy Antrian Photobox. Skrip: `deploy.sh` di root repo.*
