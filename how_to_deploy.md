# How To Deploy — Antrian Photobox (Node.js + Express + MySQL)

Panduan deploy production ke **VPS** (dan opsi cPanel). Dokumen ini berisi langkah SSH dari nol, konfigurasi server, deploy, dan gotcha yang ditemukan di lapangan supaya tidak terulang.

**Domain produksi**: `antrian.photobox.monoframe.id`

---

## 1. Informasi VPS & Path

> Isi nilai di bawah sesuai VPS Anda. Contoh diisi placeholder `<...>`.

| Item | Nilai |
|------|-------|
| IP VPS | `202.10.43.86` |
| OS | `<OS>` (contoh: Ubuntu 24.04 LTS) |
| Akses SSH | `ssh <USER>@202.10.43.86` |
| App root (git repo) | `/var/www/monobox/antrian-photobox` |
| Public root (express static) | `<APP_DIR>/public` |
| Database | MySQL/MariaDB `127.0.0.1`, DB `monf3757_antrian_photobox`, user `monf3757_antrian_photobox` |
| Node.js | 18+ |
| PM2 | Wajib (manajemen proses, 1 instance) |
| Nginx site | `/etc/nginx/sites-available/antrian.photobox.monoframe.id` |
| Env produksi | `.env.production` (gitignored, di-upload via scp) |

> **PENTING**: Aplikasi ini **wajib 1 proses tunggal** agar SSE (real-time) tersinkronisasi ke semua layar. Jangan jalankan multi-instance/cluster.

---

## 2. Cara SSH ke VPS

### 2.1 Dari Windows (PowerShell / CMD / Git Bash)

```powershell
ssh <USER>@<IP_VPS>
```

Contoh:
```powershell
ssh root@203.194.115.85
```

- Pertama kali akan muncul prompt *"Are you sure you want to continue connecting (yes/no)?"* → ketik `yes` lalu Enter.
- Lalu minta password → ketik password SSH (tidak terlihat saat diketik, itu normal) → Enter.

### 2.2 Dari Mac / Linux

```bash
ssh <USER>@<IP_VPS>
```

### 2.3 (Opsional) Login tanpa password pakai SSH key

```bash
# Di komputer lokal, buat key (sekali saja)
ssh-keygen -t ed25519 -C "antrian-deploy"

# Salin public key ke VPS
ssh-copy-id <USER>@<IP_VPS>
# (Windows tanpa ssh-copy-id: salin isi ~/.ssh/id_ed25519.pub ke ~/.ssh/authorized_keys di VPS)
```

Setelah ini `ssh <USER>@<IP_VPS>` langsung masuk tanpa password.

### 2.4 Setelah masuk SSH

```bash
whoami        # cek user aktif
pwd           # cek direktori aktif
```

---

## 3. Setup Server dari Nol (sekali saja)

Jalankan perintah berikut di dalam SSH.

### 3.1 Update sistem

```bash
sudo apt update && sudo apt upgrade -y
```

### 3.2 Install Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # harus v18.x.x
npm -v
```

### 3.3 Install MySQL / MariaDB

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
```

### 3.4 Install PM2

```bash
sudo npm install -g pm2
pm2 -v
```

### 3.5 Install Nginx (untuk reverse proxy + SSL)

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

---

## 4. Siapkan Database

```bash
sudo mysql
```

```sql
CREATE DATABASE antrian_photobox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'antrian_user'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';
GRANT ALL PRIVILEGES ON antrian_photobox.* TO 'antrian_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> Catat nama DB, user, dan password untuk dipakai di `.env`.

---

## 5. Upload & Install Aplikasi

### 5.1 Buat folder app

```bash
sudo mkdir -p <APP_DIR>
sudo chown -R $USER:$USER <APP_DIR>
```

### 5.2 Upload kode

**Opsi A — via git (disarankan):**
```bash
cd <APP_DIR>
git clone https://github.com/Iman874/antrian-photobox.git .
```

**Opsi B — via scp dari komputer lokal:**
```bash
# Dari komputer lokal (bukan di VPS)
scp -r <path_lokal_antrian-photobox>/* <USER>@<IP_VPS>:<APP_DIR>/
```

### 5.3 Install dependencies

```bash
cd <APP_DIR>
npm install --production
```

---

## 6. Konfigurasi `.env`

### 6.1 Buat `.env` dari template

```bash
cd <APP_DIR>
cp .env.production .env
nano .env
```

### 6.2 Isi `.env`

```env
NODE_ENV=production
DB_HOST=localhost
DB_PORT=3306
DB_USER=antrian_user
DB_PASS="GANTI_PASSWORD_KUAT"
DB_NAME=antrian_photobox
PORT=3000
```

> **PENTING**: `DB_HOST` harus `localhost` (MySQL di server yang sama). Jangan pakai IP remote — port 3306 diblokir firewall.

> **JANGAN commit `.env` ke git.** Pastikan `.env` ada di `.gitignore`.

---

## 7. Jalankan dengan PM2

```bash
cd <APP_DIR>
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

- `ecosystem.config.js` sudah diset `instances: 1` (fork mode) — wajib agar SSE sinkron.
- `pm2 startup` membuat PM2 auto-start saat VPS reboot.

### Perintah PM2 yang sering dipakai

```bash
pm2 status                    # cek status proses
pm2 logs antrian-photobox     # lihat log real-time
pm2 restart antrian-photobox  # restart app
pm2 stop antrian-photobox     # stop app
pm2 save                      # simpan daftar proses
```

---

## 8. Setup Domain + Reverse Proxy Nginx + SSL

### 8.1 Arahkan DNS

Buat record DNS di panel domain `monoframe.id` (DNS berada di hosting terpisah dari VPS):

| Tipe | Nama (Host) | Nilai (Target) |
|---|---|---|
| `A` | `antrian` | `202.10.43.86` |

Verifikasi:
```bash
nslookup antrian.photobox.monoframe.id
```

### 8.2 Buat config Nginx

```bash
sudo nano /etc/nginx/sites-available/antrian.photobox.monoframe.id
```

Isi:
```nginx
server {
    listen 80;
    server_name antrian.photobox.monoframe.id;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;   # PENTING untuk SSE
        proxy_cache off;
    }
}
```

Aktifkan:
```bash
sudo ln -s /etc/nginx/sites-available/antrian.photobox.monoframe.id /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> **PENTING**: `proxy_buffering off` wajib untuk SSE agar event real-time tidak tertahan buffer Nginx.

### 8.3 Aktifkan HTTPS (SSL) dengan Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d antrian.photobox.monoframe.id
```

Certbot otomatis mengonfigurasi SSL + redirect HTTP ke HTTPS.

> **PENTING**: Aplikasi ini memakai **SSE** dan **Notification API** (browser). Keduanya **wajib HTTPS** agar berfungsi di browser modern (kecuali `localhost`).

---

## 9. Keamanan MySQL

MySQL di VPS **aman hanya jika dikonfigurasi benar**. Default-nya tidak aman.

### 9.1 Bind ke localhost saja

Edit `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```ini
[mysqld]
bind-address = 127.0.0.1
```

Restart:
```bash
sudo systemctl restart mysql
```

### 9.2 Tutup port 3306 di firewall

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

> Jangan buka port 3306 ke publik. Aplikasi dan MySQL di server yang sama konek via `localhost`.

### 9.3 Amankan root MySQL

```bash
sudo mysql_secure_installation
```

### 9.4 Jangan commit `.env`

- Pastikan `.env` masuk `.gitignore`.
- **Catatan**: `.gitignore` saat ini **belum** mencantumkan `.env`. Perbaiki dengan menambahkan baris `.env` agar kredensial tidak bocor ke GitHub.

---

## 10. Verifikasi Setelah Deploy

```bash
# 1. Cek proses PM2 (harus online)
pm2 status

# 2. Cek log (harus muncul "Database initialized." tanpa error)
pm2 logs antrian-photobox

# 3. Cek endpoint API (harus JSON statistik)
curl -s http://localhost:3000/api/stats/Studio%20Utama

# 4. Cek via domain (harus 200)
curl -s -o /dev/null -w "http=%{http_code}\n" https://antrian.photobox.monoframe.id/api/stats/Studio%20Utama
```

### Uji manual (dari browser)
- Buka `https://antrian.photobox.monoframe.id` → ambil antrian → nomor muncul.
- Admin `call_next` → display & klien update real-time.
- `recall`, `cancel`, recovery antrian.
- Display indoor/outdoor sinkron.

---

## 11. Troubleshooting Cepat

| Symptom | Kemungkinan | Cek / Fix |
|---------|-------------|-----------|
| `ETIMEDOUT` koneksi DB | Port 3306 diblokir / host remote | Set `DB_HOST=localhost` |
| `Access denied` saat startup | User DB tidak punya hak | Grant ALL PRIVILEGES |
| SSE tidak real-time | Multi-proses / buffer Nginx | Pastikan 1 proses + `proxy_buffering off` |
| App lambat di banyak user | Pool MySQL 10 + polling 5s | Naikkan `connectionLimit`, kurangi polling |
| `.env` ter-commit | `.gitignore` tidak memuat `.env` | Tambahkan `.env` ke `.gitignore` |
| PM2 tidak auto-start saat reboot | `pm2 startup` belum dijalankan | Jalankan `pm2 startup` + `pm2 save` |
| HTTPS tidak aktif | Certbot belum dijalankan | `sudo certbot --nginx -d antrian.photobox.monoframe.id` |

Log error: `pm2 logs antrian-photobox`

---

*Dokumentasi: Antrian Photobox — deploy guide.*
