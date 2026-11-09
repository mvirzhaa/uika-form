import { h, clear, icon, api, session, navbar, userMenu, link, toast, modal, confirmDialog, errMsg, fmtDateTime, loginUrl } from '../core.js';

/** Dialog tambah/ubah daftar pilihan. onSaved(list) dipanggil setelah berhasil disimpan. */
export async function editListDialog({ list, readOnly = false, global = false, items: presetItems, name: presetName, onSaved }) {
  let data = list ? await api('GET', `/api/lists/${list.id}`) : { name: presetName || '', items: (presetItems || []).map((t) => ({ text: t })) };
  const nameIn = h('input', { class: 'in', value: data.name, maxlength: 120, disabled: readOnly, placeholder: 'mis. Daftar Dosen Teknik Informatika' });
  const ta = h('textarea', { class: 'in', rows: 12, disabled: readOnly, placeholder: 'Satu pilihan per baris…', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '13px' }, value: data.items.map((i) => i.text).join('\n') });
  const count = h('span', { class: 'small muted' });
  const upd = () => { const n = new Set(ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)).size; count.textContent = `${n} pilihan unik`; };
  ta.addEventListener('input', upd); upd();
  const file = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', style: { display: 'none' }, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1024 * 1024) { toast('Berkas terlalu besar (maks 1 MB)', 'err'); return; }
    const text = await f.text();
    const lines = text.split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t')[0] : l.replace(/^"?([^",]*)"?(,.*)?$/, '$1')).trim()).filter(Boolean);
    ta.value = [ta.value.trim(), ...lines].filter(Boolean).join('\n'); upd(); e.target.value = '';
  } });
  modal({
    title: readOnly ? data.name : list ? 'Ubah daftar pilihan' : (global ? 'Daftar global baru' : 'Daftar pilihan baru'), wide: true,
    body: h('div', { class: 'col' },
      global && h('p', { class: 'muted small', style: { margin: 0 } }, 'Daftar global dapat dipakai semua pembuat form.'),
      h('div', null, h('label', { class: 'f' }, 'Nama daftar'), nameIn),
      h('div', null, h('div', { class: 'row wrap', style: { marginBottom: '6px' } }, h('label', { class: 'f grow', style: { margin: 0 } }, 'Isi daftar (satu per baris)'),
        h('button', { class: 'btn sm ghost', onclick: () => file.click() }, icon('plus', 16), 'Tambah dari berkas .txt / .csv'), file), ta, count),
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Formulir yang memakai daftar ini otomatis mengikuti perubahan isinya. Baris yang kembar digabung.')),
    actions: readOnly ? [{ label: 'Tutup' }] : [{ label: 'Batal' }, { label: 'Simpan', kind: 'primary', onClick: async () => {
      try {
        const payload = { name: nameIn.value, items: ta.value.split(/\r?\n/) };
        const saved = list ? await api('PUT', `/api/lists/${list.id}`, payload) : await api('POST', '/api/lists', { ...payload, global });
        toast('Daftar disimpan'); if (onSaved) onSaved(saved); return true;
      } catch (e) { toast(errMsg(e), 'err'); return false; }
    } }],
  });
}

/** Tabel daftar. scope: 'global' (kelola daftar global, admin) atau 'mine' (daftar pribadi; global tampil baca-saja). */
export function listsManager(scope) {
  const root = h('div');
  async function load() {
    clear(root); root.append(h('div', { class: 'spinner' }));
    let all;
    try { all = await api('GET', '/api/lists'); } catch (e) { clear(root); root.append(h('p', null, errMsg(e))); return; }
    clear(root);
    const global = scope === 'global';
    const rows = all.filter((l) => (global ? l.is_global : true));
    const canAdd = global ? session.user.role === 'admin' : session.user.role !== 'user';
    root.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'grow muted small' }, global ? 'Berlaku untuk semua pengguna.' : 'Daftar pribadi hanya dapat dipakai dan diubah olehmu; daftar global dari admin dapat dipakai semua.'),
      canAdd && h('button', { class: 'btn primary sm', onclick: () => editListDialog({ global, onSaved: load }) }, icon('plus', 16), 'Daftar baru')));
    if (!rows.length) { root.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, global ? 'Belum ada daftar global.' : 'Belum ada daftar. Buat daftar (mis. daftar dosen) lalu panggil dari pertanyaan dropdown.'))); return; }
    root.append(h('div', { style: { overflowX: 'auto' } }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['Nama', 'Jenis', 'Isi', 'Diubah', ''].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((l) => h('tr', null,
        h('td', null, h('b', null, l.name)), h('td', null, l.is_global ? 'Global' : 'Pribadi'), h('td', null, `${l.count} pilihan`), h('td', null, fmtDateTime(l.updated_at)),
        h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
          l.can_edit ? h('span', null,
            h('button', { class: 'btn sm ghost', onclick: () => editListDialog({ list: l, global: l.is_global, onSaved: load }) }, 'Ubah'),
            h('button', { class: 'btn sm ghost', onclick: async () => {
              if (!await confirmDialog('Hapus daftar?', `“${l.name}” akan dihapus. Formulir yang memakainya tetap menyimpan salinan pilihan terakhir.`, 'Hapus', true)) return;
              try { await api('DELETE', `/api/lists/${l.id}`); toast('Daftar dihapus'); load(); } catch (e) { toast(errMsg(e), 'err'); }
            } }, 'Hapus')) : h('button', { class: 'btn sm ghost', onclick: () => editListDialog({ list: l, readOnly: true }).catch((e) => toast(errMsg(e), 'err')) }, 'Lihat'))))))));
  }
  load();
  return root;
}

export async function listsPage(rootEl) {
  clear(rootEl);
  rootEl.append(navbar({ right: userMenu() }));
  const page = h('main', { class: 'page' });
  rootEl.append(page);
  if (!session.user) { page.append(h('div', { class: 'empty' }, h('p', null, 'Silakan masuk dengan E-Portal.'), h('a', { class: 'btn primary', href: loginUrl('/lists') }, 'Masuk dengan E-Portal'))); return undefined; }
  page.append(h('div', { style: { marginBottom: '14px' } }, h('h1', { style: { fontSize: '30px' } }, 'Daftar pilihan'),
    h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Simpan daftar yang sering dipakai (dosen, prodi, unit…) sekali, lalu panggil di pertanyaan dropdown pada formulir mana pun.')),
  h('div', { class: 'card' }, listsManager('mine')));
  return undefined;
}
