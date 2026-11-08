#!/usr/bin/env bash
#
# deploy.sh — Deploy Antrian Photobox (Node.js + Express + MySQL/MariaDB) ke VPS.
#
# Dijalankan SEBAGAI ROOT DI SERVER, bukan dari laptop. Skrip ini tidak melakukan
# SSH keluar: ia memperlakukan mesin tempat ia dijalankan sebagai target.
#
# Cara pakai (di server, dari dalam app dir):
#   bash deploy.sh                 deploy penuh: kode, .env, npm ci, pm2, vhost nginx, SSL
#   bash deploy.sh --minimal       update rutin: pull + npm ci + pm2 restart (tidak sentuh sistem/nginx/ssl)
#   bash deploy.sh --check         BACA SAJA: kondisi server, tidak menulis apa pun
#   bash deploy.sh --no-provision  lewati instal paket sistem (node, pm2, nginx, certbot)
#   bash deploy.sh --no-db         lewati pembuatan database dan user
#   bash deploy.sh --no-nginx      lewati penulisan dan reload vhost nginx
#   bash deploy.sh --no-ssl        lewati certbot
#   bash deploy.sh --allow-dirty   lanjut walau working tree app ada perubahan lokal
#   bash deploy.sh --reset-db-password  paksa password DB user disamakan dengan .env
#   bash deploy.sh --help
#
# Override lewat environment (nilai default di bawah):
#   APP_DIR REPO_URL GIT_BRANCH DOMAIN PORT DB_NAME DB_USER ENV_SRC SSL_EMAIL
#   contoh: PORT=3010 DOMAIN=antrian.photobox.monoframe.id bash deploy.sh --check
#
# Kode keluar:
#   0 sukses
#   1 error fatal (nginx -t gagal, koneksi DB ditolak, dll)
#   2 argumen tidak dikenal
#   3 prasyarat kurang (file/folder/command belum ada)
#   4 working tree kotor dan --allow-dirty tidak diberikan
#
# Berkas yang ditulis atau diubah:
#   $APP_DIR                       dibuat bila belum ada (clone)
#   $APP_DIR/.env                  dari $ENV_SRC; versi lama dicadang .env.bak-<timestamp>
#   /etc/nginx/sites-available/$DOMAIN   file lama dicadang .bak-<timestamp>
#   /etc/nginx/sites-enabled/$DOMAIN     symlink baru, hanya bila belum ada
#   /var/log/nginx/$DOMAIN.access.log    log baru milik vhost ini
#   <APP_DIR>/.env.bak-<timestamp>       cadangan .env sebelum ditimpa
#   crontab TIDAK ditulis; auto-renew sertifikat dipegang timer certbot yang sudah ada
#
# Yang TIDAK dilakukan skrip ini: menghapus folder/file apa pun, menyentuh vhost lain,
# mengubah skema DB, menjalankan migrasi, atau me-reset git history.

set -euo pipefail

# ----------------------------------------------------------------------------- konfigurasi
# Skrip dijalankan DARI DALAM folder app, seperti skrip deploy service lain di ekosistem
# ini. Karena itu APP_DIR default adalah folder tempat skrip ini berada, bukan lokasi
# yang dikarang di header.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
REPO_URL="${REPO_URL:-https://github.com/Iman874/antrian-photobox.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DOMAIN="${DOMAIN:-antrian.photobox.monoframe.id}"
PORT="${PORT:-3000}"
DB_NAME="${DB_NAME:-monf3757_antrian_photobox}"
DB_USER="${DB_USER:-monf3757_antrian_photobox}"
ENV_SRC="${ENV_SRC:-$APP_DIR/.env.production}"
SSL_EMAIL="${SSL_EMAIL:-}"

PROVISION=1
SETUP_DB=1
NGINX=1
SSL=1
PULL=1
ALLOW_DIRTY=0
RESET_DB_PASSWORD=0
MODE="full"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
VHOST_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
VHOST_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

# die <pesan> <kode-keluar>. Kode tidak boleh ikut tercetak sebagai teks.
die() {
  local msg="$1" code="${2:-1}"
  printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$msg" >&2
  exit "$code"
}

need() { command -v "$1" >/dev/null 2>&1 || die "perintah '$1' belum ada di PATH ($2)" 3; }

# Versi perintah, atau penanda belum dipasang. stderr tidak boleh ikut tercetak.
ver() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then printf 'BELUM ADA'; return 0; fi
  case "$bin" in
    nginx)  nginx -v 2>&1 | sed 's|nginx version: ||' ;;
    mysql)  mysql --version 2>/dev/null | cut -d, -f1 ;;
    *)      "$bin" -v 2>/dev/null || printf 'BELUM ADA' ;;
  esac
}

# ----------------------------------------------------------------------------- argumen
while [ $# -gt 0 ]; do
  case "$1" in
    --minimal)         MODE="minimal"; PROVISION=0; SETUP_DB=0; NGINX=0; SSL=0 ;;
    --check)           MODE="check" ;;
    --no-provision)    PROVISION=0 ;;
    --no-db)           SETUP_DB=0 ;;
    --no-nginx)        NGINX=0 ;;
    --no-ssl)          SSL=0 ;;
    --no-pull)         PULL=0 ;;
    --allow-dirty)     ALLOW_DIRTY=1 ;;
    --reset-db-password) RESET_DB_PASSWORD=1 ;;
    -h|--help)         sed -n '2,41p' "$0"; exit 0 ;;
    *)                 printf 'Argumen tidak dikenal: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# ----------------------------------------------------------------------------- baca saja
run_check() {
  log "=== Kondisi server (tidak ada yang ditulis) ==="
  printf 'OS            : %s\n' "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | tr -d '"')"
  printf 'node          : %s\n' "$(ver node)"
  printf 'npm           : %s\n' "$(ver npm)"
  printf 'pm2           : %s\n' "$(ver pm2)"
  printf 'nginx         : %s\n' "$(ver nginx)"
  printf 'mysql client  : %s\n' "$(ver mysql)"
  printf 'App dir       : %s\n' "$([ -d "$APP_DIR" ] && echo 'ada' || echo 'BELUM ADA')"
  printf '.env produksi : %s\n' "$([ -f "$ENV_SRC" ] && echo "ada ($ENV_SRC)" || echo 'BELUM ADA')"
  printf '.env aktif    : %s\n' "$([ -f "$APP_DIR/.env" ] && echo 'ada' || echo 'BELUM ADA')"
  printf 'Vhost nginx   : %s\n' "$([ -f "$VHOST_AVAILABLE" ] && echo "ada ($VHOST_AVAILABLE)" || echo 'BELUM ADA')"
  printf 'Symlink site  : %s\n' "$([ -L "$VHOST_ENABLED" ] && echo 'ada' || echo 'BELUM ADA')"
  # Setiap perintah eksternal dijaga command -v. Dengan pipefail, perintah yang belum
  # terpasang membuat pipeline mengembalikan 127 dan set -e mematikan skrip lebih dulu,
  # padahal --check justru dijalankan sebelum ada apa pun dipasang.
  local cert="certbot belum terpasang"
  if command -v certbot >/dev/null 2>&1; then
    cert="$(certbot certificates 2>/dev/null | sed -n "s/^[[:space:]]*Name: $DOMAIN.*$/ada/p" | head -1 || true)"
    [ -n "$cert" ] || cert="belum ada untuk domain ini"
  fi
  printf 'Sertifikat    : %s\n' "$cert"

  printf 'Port %s       : ' "$PORT"
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    ss -ltnp | grep ":$PORT " | head -3
  else
    printf 'bebas\n'
  fi

  local proc="pm2 belum terpasang"
  if command -v pm2 >/dev/null 2>&1; then
    proc="$(pm2 jlist 2>/dev/null | grep -o '"name":"antrian-photobox"' | head -1 || true)"
    [ -n "$proc" ] || proc='antrian-photobox belum terdaftar'
  fi
  printf 'PM2 proses    : %s\n' "$proc"

  local ip="hostname tidak tersedia"
  if command -v hostname >/dev/null 2>&1; then
    if ip="$(hostname -I 2>/dev/null | tr -s ' ')"; then
      [ -n "$ip" ] || ip="tidak terbaca (hostname -I kosong)"
    else
      ip="tidak terbaca (hostname -I gagal)"
    fi
  fi
  log "IP box ini: $ip"
  log "Cek DNS dari luar (jalankan di laptop): nslookup $DOMAIN 8.8.8.8"
}

# ----------------------------------------------------------------------------- provision
run_provision() {
  need apt-get "Debian/Ubuntu"
  need curl
  need git

  if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
    log "Pasang paket sistem (nginx, certbot, ufw, git, curl)"
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl git ufw nginx certbot python3-certbot-nginx
  else
    log "nginx dan certbot sudah ada, paket sistem dilewati"
  fi

  local major
  major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)"
  if [ "${major:-0}" -lt 18 ]; then
    log "Node.js belum ada atau di bawah 18 (ketemu: ${major:-0}), pasang Node 20 LTS"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  fi
  log "node $(node -v), npm $(npm -v)"

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Pasang PM2 global (di package.json pm2 masuk devDependencies, jadi --omit=dev tidak memasangnya)"
    npm install -g pm2
  fi
  log "pm2 $(pm2 -v)"

  if ! command -v mysql >/dev/null 2>&1; then
    warn "mysql client belum ada, pasang mariadb-server"
    DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server
    systemctl enable --now mariadb
  fi
}

# ----------------------------------------------------------------------------- database
# Password dibaca dari ENV_SRC (kunci DB_PASS), tidak pernah ditulis ke log dan
# tidak pernah diletakkan sebagai argumen command line (hindar dari ps dan history).
read_db_pass() {
  [ -f "$ENV_SRC" ] || die "$ENV_SRC belum ada. Upload dari laptop: scp .env.production root@server:$APP_DIR/.env.production" 3
  DB_PASS="$(sed -n 's/^[[:space:]]*DB_PASS=//p' "$ENV_SRC" | tail -1 | tr -d '\r')"
  [ -n "$DB_PASS" ] || die "kunci DB_PASS kosong atau tidak ada di $ENV_SRC" 3
}

sql_quote() { printf "%s" "${1//\'/\'\'}"; }

mysql_root() {
  if mysql -u root --protocol=socket -e "SELECT 1" >/dev/null 2>&1; then
    mysql -u root --protocol=socket "$@"
  elif [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
    printf '%s' "$MYSQL_ROOT_PASSWORD" | mysql -u root -p --protocol=socket "$@"
  else
    die "tidak bisa masuk MySQL/MariaDB sebagai root via socket. Jalankan sebagai root, atau set MYSQL_ROOT_PASSWORD." 3
  fi
}

run_db() {
  need mysql
  local pass_sql; pass_sql="$(sql_quote "$DB_PASS")"
  log "Siapkan database '$DB_NAME' dan user '$DB_USER' (idempotent, tidak ada DROP)"
  mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$pass_sql';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$pass_sql';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

  if [ "$RESET_DB_PASSWORD" = "1" ]; then
    log "Paksa password user DB disamakan dengan \$ENV_SRC (--reset-db-password)"
    mysql_root <<SQL
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$pass_sql';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$pass_sql';
FLUSH PRIVILEGES;
SQL
  fi

  log "Uji koneksi TCP persis seperti yang dipakai aplikasi (mysql2)"
  # Password lewat environment, bukan argumen, agar tidak muncul di ps dan shell history.
  if ! MYSQL_PWD="$DB_PASS" mysql -h 127.0.0.1 -u "$DB_USER" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1; then
    die "koneksi '$DB_USER'@'127.0.0.1' ke '$DB_NAME' ditolak. Cek grant (perlu host 127.0.0.1) dan DB_PASS di $ENV_SRC." 1
  fi
  log "Koneksi DB OK"
}

# ----------------------------------------------------------------------------- kode
run_code() {
  need git
  local script_name extra dirty
  script_name="$(basename "${BASH_SOURCE[0]}")"
  if [ ! -d "$APP_DIR/.git" ]; then
    log "Bootstrap: $APP_DIR belum berupa repo git, ambil branch $GIT_BRANCH dari $REPO_URL"
    mkdir -p "$APP_DIR"
    # GIT_TERMINAL_PROMPT=0: repo privat membuat git meminta password di terminal
    # dan skrip menggantung tanpa pesan. Biarkan gagal, lalu beri petunjuk.
    git -C "$APP_DIR" init
    git -C "$APP_DIR" remote add origin "$REPO_URL"
    if ! GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" fetch origin "$GIT_BRANCH"; then
      die "fetch gagal. Kalau repo privat, jalankan dengan REPO_URL=git@github.com:Iman874/antrian-photobox.git dan deploy key terpasang, atau kirim foldernya lewat scp." 1
    fi
    if ! git -C "$APP_DIR" checkout -B "$GIT_BRANCH" FETCH_HEAD; then
      # git menolak menimpa berkas yang belum terlacak. Satu-satunya keadaan yang
      # boleh ditimpa tanpa bertanya: folder ini hanya berisi skrip itu sendiri,
      # yaitu skrip yang baru saja di-scp dan memang versi ter-commit yang sama.
      extra="$(ls -A "$APP_DIR" | grep -v -x -F '.git' | grep -v -x -F "$script_name" || true)"
      if [ -z "$extra" ]; then
        log "Folder hanya berisi $script_name, pakai salinan dari GitHub"
        git -C "$APP_DIR" checkout -f -B "$GIT_BRANCH" FETCH_HEAD
      else
        printf '%s\n' "$extra"
        die "checkout menolak menimpa berkas di atas. Simpan berkas itu lebih dulu, lalu ulangi." 1
      fi
    fi
  elif [ "$PULL" = "1" ]; then
    # Skrip yang sedang dijalankan ini sendiri tidak boleh dihitung sebagai kotoran:
    # setelah bootstrap clone dari salinan scp, deploy.sh memang belum terlacak di repo
    # yang ada di server (commit pembersihnya bisa jadi belum di-push).
    dirty="$(git -C "$APP_DIR" status --porcelain | grep -v -x -F "?? $script_name" || true)"
    if [ -n "$dirty" ] && [ "$ALLOW_DIRTY" != "1" ]; then
      printf '%s\n' "$dirty"
      die "working tree $APP_DIR kotor (lihat daftar di atas). Commit atau simpan perubahan itu lebih dulu, atau pakai --allow-dirty." 4
    fi
    log "git fetch + merge --ff-only origin/$GIT_BRANCH"
    if ! GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" fetch origin "$GIT_BRANCH"; then
      die "fetch gagal di $APP_DIR. Cek jaringan dan kredensial remote (git -C $APP_DIR remote -v)." 1
    fi
    if ! git -C "$APP_DIR" merge --ff-only FETCH_HEAD; then
      die "merge --ff-only gagal: riwayat lokal sudah menyimpang dari origin/$GIT_BRANCH, jadi tidak ada yang diubah. putuskan sendiri mau commit, rebase, atau reset dari branch bersih." 1
    fi
  else
    log "git pull dilewati (--no-pull), kode dipakai apa adanya"
  fi
  log "HEAD sekarang: $(git -C "$APP_DIR" log -1 --oneline)"
}

run_env_file() {
  [ -f "$ENV_SRC" ] || die "$ENV_SRC belum ada di server. Upload: scp .env.production root@server:$APP_DIR/.env.production" 3
  if [ -f "$APP_DIR/.env" ]; then
    if cmp -s "$ENV_SRC" "$APP_DIR/.env"; then
      log ".env sudah identik dengan $ENV_SRC, tidak diubah"
    else
      cp "$APP_DIR/.env" "$APP_DIR/.env.bak-$TIMESTAMP"
      log "Cadangkan .env ke .env.bak-$TIMESTAMP lalu tulis ulang dari $ENV_SRC"
      cp "$ENV_SRC" "$APP_DIR/.env"
    fi
  else
    log "Buat .env dari $ENV_SRC"
    cp "$ENV_SRC" "$APP_DIR/.env"
  fi
  # dotenv 16 memotong nilai tepat di tanda '#' kalau nilai itu tidak dikutip, jadi
  # DB_PASS yang mengandung '#' akan terbaca sebagian dan initDB() gagal diam-diam.
  # Nilai dikutip apa adanya; tidak ada isi yang dicetak.
  if grep -qE '^DB_PASS=[^"]' "$APP_DIR/.env"; then
    sed -i -E 's/^DB_PASS=([^"][^[:space:]]*)[[:space:]]*$/DB_PASS="\1"/' "$APP_DIR/.env"
    log "DB_PASS di .env dikutip agar tidak terpotong di tanda '#'"
  fi

  # Tampilkan kunci saja, nilai password tidak dicetak.
  log "Kunci di .env: $(sed -n 's/^[[:space:]]*\([A-Z_]*\)=.*/\1/p' "$APP_DIR/.env" | tr '\n' ' ')"
}

run_install() {
  cd "$APP_DIR"
  need npm
  if [ -f package-lock.json ]; then
    log "npm ci --omit=dev (pakai package-lock.json)"
    npm ci --omit=dev
  else
    warn "package-lock.json tidak ada, jatuh ke npm install --omit=dev"
    npm install --omit=dev
  fi
}

run_pm2() {
  cd "$APP_DIR"
  need pm2
  [ -f ecosystem.config.js ] || die "ecosystem.config.js tidak ada di $APP_DIR" 3
  if pm2 describe antrian-photobox >/dev/null 2>&1; then
    log "pm2 restart antrian-photobox --update-env"
    pm2 restart antrian-photobox --update-env --env production
  else
    log "pm2 start ecosystem.config.js --env production"
    pm2 start ecosystem.config.js --env production
  fi
  pm2 save
  pm2 startup >/dev/null 2>&1 || warn "pm2 startup menghasilkan instruksi manual; jalankan perintah yang dicetaknya agar auto-start saat reboot"
}

# initDB() dipanggil sebelum listen() dan kegagalannya hanya ditelan .catch(console.error),
# jadi PM2 bisa menampilkan "online" tanpa ada listener sama sekali. Cek ini memaksa
# kegagalan itu terlihat saat deploy, bukan saat layar customer balas 502.
run_listen_check() {
  local i code=000
  for i in 1 2 3 4 5; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/stats/Studio%20Utama" || echo 000)"
    [ "$code" = "200" ] && break
    sleep 2
  done
  if [ "$code" != "200" ]; then
    pm2 logs antrian-photobox --lines 25 --nostream || true
    die "aplikasi tidak menjawab 200 di port $PORT (terakhir: $code). Penyebab tersering: DB_PASS tidak cocok, DB_NAME salah, atau port dipakai layanan lain." 1
  fi
  log "Listener port $PORT menjawab 200"
}

run_nginx() {
  need nginx
  if [ -f "$VHOST_AVAILABLE" ]; then
    cp "$VHOST_AVAILABLE" "$VHOST_AVAILABLE.bak-$TIMESTAMP"
    log "Cadangkan vhost lama ke $VHOST_AVAILABLE.bak-$TIMESTAMP"
  fi
  log "Tulis vhost $VHOST_AVAILABLE (hanya file ini, vhost lain tidak disentuh)"
  cat > "$VHOST_AVAILABLE" <<'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    access_log /var/log/nginx/__DOMAIN__.access.log;
    error_log  /var/log/nginx/__DOMAIN__.error.log;

    location / {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: Connection dikosongkan, bukan "upgrade" (itu pola WebSocket).
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        gzip off;

        # Lebih panjang dari heartbeat 30 detik aplikasi (src/services/sse.js).
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX_EOF
  sed -i "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$VHOST_AVAILABLE"

  if [ ! -L "$VHOST_ENABLED" ]; then
    ln -s "$VHOST_AVAILABLE" "$VHOST_ENABLED"
    log "Symlink aktif: $VHOST_ENABLED"
  else
    log "Symlink sudah ada"
  fi

  if ! nginx -t; then
    warn "nginx -t gagal. Reload TIDAK dijalankan."
    if [ -f "$VHOST_AVAILABLE.bak-$TIMESTAMP" ]; then
      warn "Salinan lama ada di $VHOST_AVAILABLE.bak-$TIMESTAMP"
    fi
    die "Perbaiki konfigurasi lalu ulangi: nginx -t && systemctl reload nginx" 1
  fi
  systemctl reload nginx
  log "nginx reload OK"
}

run_ssl() {
  need certbot
  local args=(--nginx -d "$DOMAIN" --redirect --non-interactive)
  if [ -n "$SSL_EMAIL" ]; then
    args+=(--agree-tos -m "$SSL_EMAIL")
  else
    args+=(--agree-tos --no-eff-email)
    warn "SSL_EMAIL tidak diset, certbot pakai --no-eff-email (tidak ada notifikasi expiry lewat email)"
  fi
  log "certbot ${args[*]}"
  certbot "${args[@]}"
  certbot certificates | sed -n "/Name: $DOMAIN/,/Expiry/p" \
    || warn "certbot certificates tidak bisa dibaca; cek manual: certbot certificates"
}

run_verify() {
  log "=== Verifikasi ==="
  pm2 status | sed -n '1,12p'
  local stats code
  stats="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/stats/Studio%20Utama" || echo 000)"
  printf 'API lokal  http://127.0.0.1:%s/api/stats  -> %s\n' "$PORT" "$stats"
  [ "$stats" = "200" ] || warn "API lokal tidak 200. Baca: pm2 logs antrian-photobox --lines 50"

  for scheme in http https; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$scheme://$DOMAIN/" || echo 000)"
    printf '%s://%s/  -> %s\n' "$scheme" "$DOMAIN" "$code"
  done

  log "Cek SSE manual (harus ada event dalam beberapa detik, berhenti dengan Ctrl+C):"
  printf '  curl -N https://%s/api/stream/All\n' "$DOMAIN"
  log "Cek halaman manual:"
  for p in /monoframe /display/indoor /admin/indoor /indoor/queue; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN$p" || echo 000)"
    printf '  %-16s -> %s\n' "$p" "$code"
  done
}

# ----------------------------------------------------------------------------- utama
[ "$(id -u)" = "0" ] || die "skrip ini harus dijalankan sebagai root (atau lewat sudo)" 3

log "Target: $DOMAIN -> 127.0.0.1:$PORT | app: $APP_DIR | DB: $DB_NAME"
log "Mode: $MODE (provision=$PROVISION db=$SETUP_DB nginx=$NGINX ssl=$SSL pull=$PULL)"

if [ "$MODE" = "check" ]; then
  run_check
  exit 0
fi

if [ "$MODE" = "full" ]; then
  if [ "$PROVISION" = "1" ]; then run_provision; fi
  read_db_pass
  run_code
  run_env_file
  if [ "$SETUP_DB" = "1" ]; then run_db; fi
  run_install
  run_pm2
  run_listen_check
  if [ "$NGINX" = "1" ]; then run_nginx; fi
  if [ "$SSL" = "1" ]; then run_ssl; fi
else
  run_code
  run_env_file
  run_install
  run_pm2
  run_listen_check
fi

run_verify
log "SELESAI. Verifikasi manual yang tersisa: ambil antrian, call_next, SSE lintas layar, recovery, dan password admin."
