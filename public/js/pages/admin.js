import { listsManager } from './lists.js';
import { adminFormsPane } from './admin-forms.js';
import { h, clear, api, navbar, userMenu, session, toast, fmtDateTime, errMsg, debounce, link, icon, loginUrl } from '../core.js';

export async function adminPage(root) {
  clear(root);
  root.append(navbar({ right: userMenu() }));
  const page = h('main', { class: 'page' });
  root.append(page);
  if (!session.user) { page.append(h('div', { class: 'empty' }, h('p', null, 'Silakan masuk.'), h('a', { class: 'btn primary', href: loginUrl() }, 'Masuk'))); return undefined; }
  if (session.user.role !== 'admin') { page.append(h('div', { class: 'empty' }, h('h2', null, 'Khusus admin'))); return undefined; }

  const list = h('div');
  const search = h('input', { class: 'in', placeholder: 'Cari nama atau email…', style: { maxWidth: '320px' } });
  const formsPane = adminFormsPane();
  const usersPane = h('div', { style: { display: 'none' } },
    h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, h('div', { class: 'grow' }, h('h1', { style: { fontSize: '30px' } }, 'Pengguna'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Admin mengatur siapa yang boleh membuat formulir. Akses editor sebuah formulir tetap hanya untuk pemilik dan email yang ia daftarkan.')), search),
    h('div', { class: 'card' }, list));
  const listsPane = h('div', { style: { display: 'none' } },
    h('div', { style: { marginBottom: '14px' } }, h('h1', { style: { fontSize: '30px' } }, 'Daftar pilihan global'), h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Daftar yang dikelola admin ini muncul di semua pembuat form sebagai sumber pilihan dropdown (mis. daftar dosen, program studi, unit kerja).')),
    h('div', { class: 'card' }, listsManager('global')));
  const panes = [['Formulir', formsPane, 'list'], ['Pengguna', usersPane, 'users'], ['Daftar pilihan global', listsPane, 'drop']];
  const tabs = h('div', { class: 'seg seg-fill', style: { marginBottom: '18px' } });
  const show = (i) => { panes.forEach(([, pane], k) => { pane.style.display = k === i ? '' : 'none'; }); [...tabs.children].forEach((b, k) => b.classList.toggle('on', k === i)); };
  panes.forEach(([label, , ic], i) => tabs.append(h('button', { class: i === 0 ? 'on' : '', onclick: () => show(i) }, icon(ic, 16), label)));
  page.append(h('div', { style: { display: 'flex', justifyContent: 'center' } }, tabs), formsPane, usersPane, listsPane);

  async function load() {
    clear(list); list.append(h('div', { class: 'spinner' }));
    try {
      const users = await api('GET', `/api/admin/users?search=${encodeURIComponent(search.value)}`);
      clear(list);
      list.append(h('div', { style: { overflowX: 'auto' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Nama', 'Email', 'NIM/NIP', 'Formulir', 'Login terakhir', 'Peran'].map((x) => h('th', null, x)))),
        h('tbody', null, users.map((u) => h('tr', null,
          h('td', null, u.name || '—'), h('td', null, u.email), h('td', null, u.identifier || '—'), h('td', null, String(u.forms)), h('td', null, fmtDateTime(u.last_login)),
          h('td', null, h('select', { class: 'in', style: { padding: '6px 28px 6px 10px', width: 'auto' }, value: u.role, onchange: async (e) => {
            try { await api('PATCH', `/api/admin/users/${u.id}`, { role: e.target.value }); toast('Peran diperbarui'); } catch (er) { toast(errMsg(er), 'err'); load(); }
          } }, ['creator', 'user', 'admin'].map((r) => h('option', { value: r }, { creator: 'Pembuat form', user: 'Hanya mengisi', admin: 'Admin' }[r]))))))))));
    } catch (e) { clear(list); list.append(h('p', null, errMsg(e))); }
  }
  search.addEventListener('input', debounce(load, 300));
  await load();
  return undefined;
}
