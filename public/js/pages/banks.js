/* Bank soal: kumpulan pertanyaan yang dipakai ulang di banyak formulir (pribadi, atau global oleh admin). */
import { h, clear, icon, api, session, navbar, userMenu, link, toast, modal, confirmDialog, errMsg, fmtDateTime, loginUrl } from '../core.js';

const TYPE_LABEL = { short: 'Jawaban singkat', paragraph: 'Esai', radio: 'Pilihan ganda', checkbox: 'Kotak centang', dropdown: 'Dropdown', scale: 'Skala', date: 'Tanggal', time: 'Waktu', grid: 'Kisi', ranking: 'Peringkat', file: 'Unggah berkas' };

export async function banksPage(root) {
  clear(root);
  if (!session.user) { root.append(navbar({ right: userMenu() }), h('div', { class: 'center-screen' }, h('div', null, h('h2', null, 'Masuk untuk mengelola bank soal'), h('a', { class: 'btn primary', href: loginUrl() }, 'Masuk')))); return undefined; }
  if (session.user.role === 'user') { root.append(navbar({ right: userMenu() }), h('div', { class: 'center-screen' }, h('div', null, h('h2', null, 'Khusus pembuat formulir'), link('/', { class: 'btn primary' }, 'Ke beranda')))); return undefined; }
  const host = h('div');
  root.append(navbar({ right: userMenu() }), h('main', { class: 'page narrow' },
    h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, link('/', { class: 'btn icon ghost', title: 'Kembali' }, icon('back')), h('div', { class: 'grow' }, h('h1', { style: { fontSize: '28px' } }, 'Bank soal'),
      h('div', { class: 'small muted' }, 'Simpan soal dari Editor (tombol “Simpan ke bank”), lalu ambil semua atau sebagian secara acak ke formulir mana pun.'))), host));

  async function load() {
    clear(host); host.append(h('div', { class: 'spinner' }));
    let banks;
    try { banks = await api('GET', '/api/banks'); } catch (e) { clear(host); host.append(h('p', null, errMsg(e))); return; }
    clear(host);
    const isAdmin = session.user.role === 'admin';
    host.append(h('div', { class: 'row wrap', style: { marginBottom: '12px' } }, h('span', { class: 'grow' }),
      h('button', { class: 'btn sm primary', onclick: () => newBank(false) }, icon('plus', 16), 'Bank baru'),
      isAdmin && h('button', { class: 'btn sm', onclick: () => newBank(true) }, icon('plus', 16), 'Bank global baru')));
    if (!banks.length) { host.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🏦'), h('p', null, 'Belum ada bank soal.'))); return; }
    host.append(h('div', { class: 'card' }, h('table', { class: 't' }, h('tbody', null, banks.map((b) => h('tr', null,
      h('td', null, h('b', null, b.name), h('div', { class: 'tiny muted' }, `${b.count} soal · diubah ${fmtDateTime(b.updated_at)}`)),
      h('td', null, b.is_global ? h('span', { class: 'pill blue' }, 'Global') : h('span', { class: 'pill' }, 'Pribadi')),
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('button', { class: 'btn sm', onclick: () => view(b) }, b.can_edit ? 'Kelola' : 'Lihat'),
        b.can_edit && h('button', { class: 'btn sm ghost', style: { color: 'var(--danger)' }, onclick: async () => { if (!await confirmDialog(`Hapus bank “${b.name}”?`, 'Soal di dalamnya terhapus dari bank. Formulir yang sudah memakai salinannya tidak terpengaruh.', 'Hapus', true)) return; try { await api('DELETE', `/api/banks/${b.id}`); toast('Bank dihapus'); load(); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 16)))))))));
  }

  function newBank(global) {
    const name = h('input', { class: 'in', maxlength: 120, placeholder: 'mis. Pemrograman Berorientasi Objek — UTS' });
    modal({ title: global ? 'Bank global baru' : 'Bank soal baru', body: h('div', null, h('label', { class: 'f' }, 'Nama bank'), name),
      actions: [{ label: 'Batal' }, { label: 'Buat', kind: 'primary', onClick: async () => { try { await api('POST', '/api/banks', { name: name.value, global, questions: [] }); load(); } catch (e) { toast(errMsg(e), 'err'); return false; } } }] });
  }

  async function view(b) {
    let d; try { d = await api('GET', `/api/banks/${b.id}`); } catch (e) { toast(errMsg(e), 'err'); return; }
    const name = h('input', { class: 'in', value: d.name, maxlength: 120, disabled: !d.can_edit });
    const list = h('div', { class: 'scroll-y', style: { maxHeight: '50vh' } });
    const paint = () => {
      clear(list);
      if (!d.questions.length) { list.append(h('p', { class: 'small muted' }, 'Bank masih kosong.')); return; }
      d.questions.forEach((q, i) => list.append(h('div', { class: 'row', style: { padding: '8px 0', borderTop: i ? '.5px solid var(--line)' : '', alignItems: 'flex-start' } },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, `${i + 1}. ${q.title}`), h('div', { class: 'tiny muted' }, `${TYPE_LABEL[q.type] || q.type}${q.points ? ` · ${q.points} poin` : ''}${q.correct?.length ? ' · berkunci' : ''}`)),
        d.can_edit && h('button', { class: 'btn icon ghost', title: 'Hapus soal', onclick: () => { d.questions.splice(i, 1); paint(); } }, icon('x', 16)))));
    };
    paint();
    modal({ title: d.can_edit ? 'Kelola bank soal' : d.name, wide: true, body: h('div', { class: 'col' }, h('div', null, h('label', { class: 'f' }, 'Nama'), name), h('div', null, h('label', { class: 'f' }, `Soal (${d.questions.length})`), list)),
      actions: d.can_edit ? [{ label: 'Batal' }, { label: 'Simpan', kind: 'primary', onClick: async () => { try { await api('PUT', `/api/banks/${b.id}`, { name: name.value, questions: d.questions }); toast('Bank disimpan'); load(); } catch (e) { toast(errMsg(e), 'err'); return false; } } }] : [{ label: 'Tutup' }] });
  }

  load();
  return undefined;
}
