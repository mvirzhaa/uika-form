'use strict';
const config = require('./config');
const { migrate, pool } = require('./db');
const { createApp } = require('./app');

(async () => {
  await migrate();
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`UIKA Form berjalan di ${config.BASE_URL} (port ${config.PORT})`);
    if (config.DEV_LOGIN) console.warn('PERINGATAN: DEV_LOGIN aktif. Jangan dipakai di produksi.');
  });
  const stop = () => { server.close(() => pool.end().then(() => process.exit(0))); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch((e) => { console.error('gagal memulai:', e); process.exit(1); });
