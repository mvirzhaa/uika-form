import { h, clear, icon, api, session, navbar, userMenu, link, navigate, toast, modal, confirmDialog, copyText, fillUrl, fmtDateTime, errMsg, loginUrl, logo } from '../core.js';

const STATUS = { draft: ['Draf', ''], published: ['Dibuka', 'ok'], closed: ['Ditutup', 'bad'] };

export async function dashboardPage(root) {
  clear(root);
  root.append(navbar({ right: userMenu() }));
  if (!session.user) return landing(root);
  const page = h('main', { class: 'page' });
  root.append(page);
  page.append(h('div', { class: 'spinner' }));
  let forms;
  try { forms = await api('GET', '/api/forms'); } catch (e) { clear(page); page.append(h('p', null, errMsg(e))); return undefined; }

  const canCreate = session.user.role !== 'user';
  const create = async (kind) => {
    try { const f = await api('POST', '/api/forms', { kind }); navigate(`/forms/${f.id}/edit`); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const head = h('div', { class: 'row wrap', style: { marginBottom: '18px' } },
    h('div', { class: 'grow' }, h('h1', { style: { fontSize: '32px' } }, 'Formulir saya'), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Survei, pendaftaran kegiatan, dan kuis dengan sertifikat otomatis')),
    h('a', { class: 'btn', href: '/api/templates/survey.xlsx', download: '' }, icon('download'), 'Template Excel'),
    canCreate && h('button', { class: 'btn', onclick: () => create('quiz') }, icon('clock'), 'Kuis baru'),
    canCreate && h('button', { class: 'btn primary', onclick: () => create('form') }, icon('plus'), 'Formulir baru'));
  clear(page); page.append(head);
  if (!canCreate) page.append(h('div', { class: 'card small muted', style: { marginBottom: '14px' } }, 'Akun Anda belum diizinkan membuat formulir. Anda tetap dapat mengisi formulir dan membuka formulir yang dibagikan kepada Anda sebagai editor.'));

  if (!forms.length) {
    page.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '📝'), h('h2', null, 'Belum ada formulir'), h('p', null, 'Mulai dari formulir kosong, atau unduh template Excel, isi, lalu impor.')));
    return undefined;
  }
  const grid = h('div', { class: 'grid' });
  for (const f of forms) {
    const [label, cls] = STATUS[f.status];
    const band = h('div', { class: 'band', style: f.theme.header_style === 'image' && f.theme.header_image
      ? { backgroundImage: `url(/uploads/${f.theme.header_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: f.theme.header_style === 'solid' ? f.theme.color : `linear-gradient(135deg, ${f.theme.color}, color-mix(in srgb, ${f.theme.color} 55%, #5e17eb))` } },
    h('span', { class: `pill ${cls}` }, label));
    const card = h('div', { class: 'fcard', tabindex: 0, role: 'link', onclick: (e) => { if (!e.target.closest('button')) navigate(`/forms/${f.id}/edit`); }, onkeydown: (e) => { if (e.key === 'Enter') navigate(`/forms/${f.id}/edit`); } },
      band,
      h('div', { class: 'body' },
        h('h3', null, f.title),
        h('div', { class: 'row wrap small muted' },
          h('span', { class: `pill ${f.settings.is_quiz ? 'blue' : ''}` }, f.settings.is_quiz ? 'Kuis' : 'Formulir'),
          f.cert.enabled && h('span', { class: 'pill warn' }, icon('award', 12), 'Sertifikat'),
          f.role === 'editor' && h('span', { class: 'pill' }, 'Editor'),
          h('span', null, `${f.response_count} respons`)),
        h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, `Diubah ${fmtDateTime(f.updated_at)}${f.role === 'editor' ? ` · pemilik: ${f.owner_name || f.owner_email}` : ''}`)),
      h('div', { class: 'foot' },
        h('button', { class: 'btn icon ghost', title: 'Salin tautan pengisian', onclick: () => copyText(fillUrl(f.slug)) }, icon('link')),
        h('button', { class: 'btn icon ghost', title: 'Buka Mode Pengisian', onclick: () => window.open(`/f/${f.slug}${f.status === 'published' ? '' : '?preview=1'}`, '_blank') }, icon('eye')),
        h('button', { class: 'btn icon ghost', title: 'Gandakan', onclick: async () => { try { const c = await api('POST', `/api/forms/${f.id}/duplicate`); navigate(`/forms/${c.id}/edit`); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('copy')),
        h('span', { class: 'spacer' }),
        f.role === 'owner' && h('button', { class: 'btn icon ghost', title: 'Hapus', style: { color: 'var(--danger)' }, onclick: async () => {
          if (!await confirmDialog('Hapus formulir?', `“${f.title}” beserta ${f.response_count} responsnya akan dihapus permanen.`, 'Hapus', true)) return;
          try { await api('DELETE', `/api/forms/${f.id}`); card.remove(); toast('Formulir dihapus'); } catch (e) { toast(errMsg(e), 'err'); }
        } }, icon('trash'))));
    grid.append(card);
  }
  page.append(grid);
  return undefined;
}

function landing(root) {
  const feat = (ic, t, d) => h('div', { class: 'card' }, h('div', { class: 'logo', style: { width: '40px', height: '40px', borderRadius: '12px', marginBottom: '12px' } }, icon(ic)), h('h3', null, t), h('p', { class: 'muted small', style: { margin: 0 } }, d));
  const hasLogin = session.login && (session.login.sso || session.login.oidc || session.login.dev);
  root.append(h('main', { class: 'page' },
    h('section', { style: { textAlign: 'center', padding: '48px 0 28px' } },
      h('div', { class: 'logo', style: { width: '72px', height: '72px', borderRadius: '20px', margin: '0 auto 18px' } }, icon('list', 36)),
      h('h1', { style: { fontSize: 'clamp(34px,7vw,56px)', fontWeight: 700 } }, 'Survei, formulir, dan kuis.'),
      h('p', { class: 'muted', style: { fontSize: '19px', maxWidth: '560px', margin: '14px auto 24px' } }, 'Buat dalam hitungan menit, nilai otomatis, dan terbitkan sertifikat berkode QR untuk setiap peserta.'),
      h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
        hasLogin ? h('a', { class: 'btn primary lg', href: loginUrl('/') }, 'Masuk dengan E-Portal') : h('a', { class: 'btn primary lg', href: session.eportal_url || 'https://eportal.uika-bogor.ac.id' }, 'Masuk dengan E-Portal'),
        link('/verify', { class: 'btn lg' }, icon('qr'), 'Verifikasi sertifikat'))),
    h('div', { class: 'grid', style: { marginTop: '24px' } },
      feat('list', 'Seperti Google Form', 'Pilihan ganda, kotak centang, dropdown, skala, esai, tanggal, dan waktu.'),
      feat('clock', 'Kuis dengan timer', 'Durasi pengerjaan; saat waktu habis jawaban terkirim otomatis dan dinilai.'),
      feat('award', 'Sertifikat otomatis', 'Latar, logo sponsor, dan QR verifikasi — unduh atau kirim ke email.'),
      feat('file', 'Template Excel', 'Unggah daftar soal dari Excel; unduh rekap jawaban kapan saja.'))));
}
