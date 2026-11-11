'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cleanLayout, resolveLayout, defaultLayout, KEYS } = require('../src/certLayout');
const schema = require('../src/schema');

test('cleanLayout membatasi nilai & membuang kunci asing', () => {
  const L = cleanLayout({ name: { x: 150, y: -5, size: 99, align: 'tengah', color: 'red', bold: true, evil: 1 }, hacker: { x: 1 } });
  assert.deepStrictEqual(L, { name: { x: 100, y: 0, size: 25, bold: true } });
  assert.strictEqual(cleanLayout('x'), null);
  assert.strictEqual(cleanLayout({}), null);
});

test('resolveLayout: bawaan templat + timpaan, judul kegiatan disembunyikan untuk teks isi lama', () => {
  const cert = schema.cleanCert({ template: 'minimal', layout: { name: { x: 30 } } });
  const L = resolveLayout(cert);
  assert.deepStrictEqual(Object.keys(L), KEYS);
  assert.strictEqual(L.name.x, 30);
  assert.strictEqual(L.title.align, defaultLayout('minimal').title.align);
  assert.strictEqual(L.event.show, true);
  const old = resolveLayout(schema.cleanCert({ body: 'telah mengikuti "{{judul}}"' }));
  assert.strictEqual(old.event.show, false);
  const forced = resolveLayout(schema.cleanCert({ body: 'ikut {{judul}}', layout: { event: { show: true } } }));
  assert.strictEqual(forced.event.show, true);
});

test('cleanTheme menerima mode terang/gelap', () => {
  assert.strictEqual(schema.cleanTheme({ mode: 'dark' }).mode, 'dark');
  assert.strictEqual(schema.cleanTheme({ mode: 'neon' }).mode, 'light');
});

test('renderCertificate menghasilkan PDF untuk semua templat dengan tata letak kustom', async () => {
  const { renderCertificate } = require('../src/certificate');
  for (const template of ['classic', 'modern', 'elegant', 'minimal']) {
    const cert = schema.cleanCert({ enabled: true, template, footer: 'pada {{tanggal}}', layout: { name: { size: 6, upper: true, font: 'serif' }, qr: { align: 'right', x: 95 } } });
    const { pdf } = await renderCertificate({ cert, formTitle: 'Uji', name: 'Nama Sangat Panjang Sekali Untuk Menguji Pengecilan Otomatis Huruf', date: new Date(), score: 90, code: 'UIKA-TEST-0000-00', number: '001/X' });
    assert.ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 2000);
  }
});
