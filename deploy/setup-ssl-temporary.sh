#!/bin/bash
set -e

DOMAIN="utility.uika-bogor.ac.id"

echo "=== [1/3] Membuat Sertifikat SSL Sementara (Self-Signed) ==="
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/uika-form-selfsigned.key \
  -out /etc/ssl/certs/uika-form-selfsigned.crt \
  -subj "/C=ID/ST=Jawa Barat/L=Bogor/O=UIKA/CN=$DOMAIN"

chmod 600 /etc/ssl/private/uika-form-selfsigned.key
chmod 644 /etc/ssl/certs/uika-form-selfsigned.crt

echo "=== [2/3] Memperbarui Konfigurasi Nginx untuk Port 80 & 443 ==="
cat << 'EOF' > /etc/nginx/sites-available/utility.uika-bogor.ac.id
server {
    listen 80;
    server_name utility.uika-bogor.ac.id;
    client_max_body_size 6M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 443 ssl;
    server_name utility.uika-bogor.ac.id;
    client_max_body_size 6M;

    ssl_certificate /etc/ssl/certs/uika-form-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/uika-form-selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Pastikan symlink aktif di sites-enabled
if [ -d /etc/nginx/sites-enabled ]; then
    ln -sf /etc/nginx/sites-available/utility.uika-bogor.ac.id /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
fi

echo "=== [3/3] Pengujian dan Reload Nginx ==="
nginx -t
systemctl reload nginx

echo "=== Selesai! Port 443 (HTTPS) dan Port 80 (HTTP) Sudah Aktif ==="
echo "Catatan: Browser akan menampilkan peringatan 'Self-Signed' sampai DNS resmi diarahkan dan Certbot dijalankan."
