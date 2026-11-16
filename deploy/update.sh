#!/bin/bash
set -e

APP_DIR="/var/www/uika-form"
cd "$APP_DIR"

echo "=== [1/3] Menarik kode terbaru dari GitHub ==="
git pull origin main

echo "=== [2/3] Memperbarui konfigurasi Nginx & Landing Page ==="
if [ -f /etc/nginx/sites-available/utility.uika-bogor.ac.id ]; then
    cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/utility.uika-bogor.ac.id
elif [ -f /etc/nginx/conf.d/utility.conf ]; then
    cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/conf.d/utility.conf
else
    cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/utility.uika-bogor.ac.id || true
fi

nginx -t && systemctl reload nginx

echo "=== [3/3] Rebuild & restart container UIKA Form ==="
docker compose up -d --build app

echo "=== Update Berhasil Selesai! ==="
