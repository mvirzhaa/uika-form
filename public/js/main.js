import { route, startRouter, loadSession } from './core.js';
import { dashboardPage } from './pages/dashboard.js';
import { editorPage } from './pages/editor.js';
import { fillPage } from './pages/fill.js';
import { verifyPage } from './pages/verify.js';
import { adminPage } from './pages/admin.js';
import { listsPage } from './pages/lists.js';
import { banksPage } from './pages/banks.js';
import { checkinPage } from './pages/checkin.js';
import { setLang } from './i18n.js';

route('/', dashboardPage);
route('/forms/:id/edit', editorPage);     // Mode Editor (pembuat + editor terdaftar)
route('/f/:slug', fillPage);              // Mode Pengisian (peserta)
route('/verify', verifyPage);
route('/verify/:code', verifyPage);
route('/admin', adminPage);
route('/lists', listsPage);
route('/banks', banksPage);
route('/checkin/:token', checkinPage);

const urlLang = new URLSearchParams(location.search).get('lang');
if (urlLang === 'en' || urlLang === 'id') setLang(urlLang);

(async () => { await loadSession(); await startRouter(); })();
