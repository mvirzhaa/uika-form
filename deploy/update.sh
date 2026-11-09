#!/bin/bash
set -e

APP_DIR="/var/www/uika-form"
cd "$APP_DIR"

echo "=== Menarik kode terbaru dari GitHub ==="
git pull origin main

echo "=== Rebuild & restart container ==="
docker compose up -d --build

echo "=== Update selesai! ==="
