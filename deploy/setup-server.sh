#!/bin/bash
set -e

DOMAIN="utility.uika-bogor.ac.id"
APP_DIR="/var/www/uika-form"

echo "=== [1/6] Update System Packages ==="
if [ -f /etc/debian_version ]; then
    apt-get update -y
    apt-get install -y git curl ufw nginx certbot python3-certbot-nginx
    # Install docker if not present
    if ! command -v docker &> /dev/null; then
        echo "Menginstall Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm -f get-docker.sh
    fi
elif [ -f /etc/redhat-release ]; then
    dnf install -y git curl nginx certbot python3-certbot-nginx
fi

echo "=== [2/6] Setup Direktori Aplikasi ==="
mkdir -p /var/www

# Salin konfigurasi Nginx
echo "=== [3/6] Konfigurasi Nginx ==="
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/utility.uika-bogor.ac.id || cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/conf.d/utility.conf
if [ -d /etc/nginx/sites-enabled ]; then
    ln -sf /etc/nginx/sites-available/utility.uika-bogor.ac.id /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx || systemctl restart nginx

echo "=== [4/6] Menyiapkan .env Produksi ==="
if [ ! -f "$APP_DIR/.env" ]; then
    RANDOM_SECRET=$(openssl rand -hex 32)
    cat <<EOF > "$APP_DIR/.env"
# --- Dasar ---
PORT=8080
BASE_URL=https://utility.uika-bogor.ac.id
NODE_ENV=production
SESSION_SECRET=$RANDOM_SECRET
TRUST_PROXY=1
RATE_LIMIT_PER_MIN=300
ORG_NAME=Universitas Ibn Khaldun Bogor

# --- PostgreSQL ---
DATABASE_URL=postgres://uikaform:uikaform@db:5432/uikaform

# --- Login E-Portal (OIDC) ---
OIDC_ISSUER=https://eportal.uika-bogor.ac.id
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_SCOPE=openid profile email
OIDC_ID_CLAIM=preferred_username

# --- Peran ---
ADMIN_EMAILS=admin@uika-bogor.ac.id
DEFAULT_ROLE=creator

# --- Email (SMTP opsional) ---
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
MAIL_FROM=UIKA Form <no-reply@uika-bogor.ac.id>

# DEV_LOGIN DILARANG di produksi
DEV_LOGIN=false
EOF
    echo ".env produksi berhasil dibuat dengan random SESSION_SECRET."
fi

echo "=== [5/6] Menjalankan Docker Compose ==="
cd "$APP_DIR"
docker compose down || true
docker compose up -d --build

echo "=== [6/6] Request SSL Let's Encrypt ==="
echo "Catatan: Pastikan DNS domain $DOMAIN sudah mengarah ke IP publik server ini."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "Peringatan: Certbot otomatis belum berhasil. Silakan jalankan manual:"
    echo "certbot --nginx -d $DOMAIN"
}

echo "=== Deployment Selesai! ==="
echo "Aplikasi dapat diakses di: https://$DOMAIN"
