'use strict';
const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
function configured() { return !!(config.SMTP.url || config.SMTP.host); }

function getTransport() {
  if (!configured()) { const e = new Error('SMTP belum dikonfigurasi'); e.code = 'smtp_not_configured'; throw e; }
  if (!transport) {
    transport = config.SMTP.url
      ? nodemailer.createTransport(config.SMTP.url)
      : nodemailer.createTransport({
        host: config.SMTP.host, port: config.SMTP.port, secure: config.SMTP.secure,
        auth: config.SMTP.user ? { user: config.SMTP.user, pass: config.SMTP.pass } : undefined,
      });
  }
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendCertificate({ to, name, formTitle, code, verifyUrl, pdf }) {
  const t = getTransport();
  const safeFile = `Sertifikat-${String(formTitle).replace(/[^\w.-]+/g, '_').slice(0, 40)}.pdf`;
  await t.sendMail({
    from: config.SMTP.from,
    to,
    subject: `Sertifikat: ${formTitle}`,
    text: `Halo ${name},\n\nTerima kasih telah berpartisipasi dalam "${formTitle}". Sertifikat Anda terlampir.\nKode verifikasi: ${code}\nVerifikasi: ${verifyUrl}\n\n${config.ORG_NAME}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#1d1d1f">
      <h2 style="margin:0 0 12px">Sertifikat Anda sudah siap</h2>
      <p>Halo <b>${esc(name)}</b>,</p>
      <p>Terima kasih telah berpartisipasi dalam <b>${esc(formTitle)}</b>. Sertifikat terlampir pada email ini.</p>
      <p style="background:#f5f5f7;border-radius:12px;padding:14px 16px">Kode verifikasi: <b>${esc(code)}</b><br>
      <a href="${esc(verifyUrl)}">${esc(verifyUrl)}</a></p>
      <p style="color:#6e6e73;font-size:13px">${esc(config.ORG_NAME)}</p></div>`,
    attachments: [{ filename: safeFile, content: pdf, contentType: 'application/pdf' }],
  });
}

const T = {
  id: {
    ownerSubject: (t, n) => (n > 1 ? `${n} respons baru: ${t}` : `Respons baru: ${t}`),
    ownerText: (t, n, who, extra, url) => `Ada ${n} respons baru pada "${t}".\n${who}${extra}\nLihat rekap: ${url}`,
    confSubject: (t) => `Jawaban diterima: ${t}`,
    confHi: (n) => `Halo ${n},`, confBody: (t) => `Terima kasih, jawaban Anda untuk "${t}" sudah kami terima.`,
    score: (s, m, p) => `Nilai Anda: ${s} / ${m} (${p}%)`, certNote: 'Sertifikat Anda terlampir pada email terpisah.',
  },
  en: {
    ownerSubject: (t, n) => (n > 1 ? `${n} new responses: ${t}` : `New response: ${t}`),
    ownerText: (t, n, who, extra, url) => `There ${n > 1 ? 'are' : 'is'} ${n} new response${n > 1 ? 's' : ''} on "${t}".\n${who}${extra}\nView results: ${url}`,
    confSubject: (t) => `Response received: ${t}`,
    confHi: (n) => `Hello ${n},`, confBody: (t) => `Thank you, your response to "${t}" has been received.`,
    score: (s, m, p) => `Your score: ${s} / ${m} (${p}%)`, certNote: 'Your certificate is sent in a separate email.',
  },
};

async function sendOwnerNotice({ to, title, count, who, extra, url, lang = 'id' }) {
  const t = T[lang] || T.id;
  await getTransport().sendMail({
    from: config.SMTP.from, to, subject: t.ownerSubject(title, count),
    text: t.ownerText(title, count, who, extra ? `\n${extra}` : '', url),
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#1d1d1f"><h3 style="margin:0 0 10px">${esc(t.ownerSubject(title, count))}</h3>
      <p>${esc(who)}${extra ? `<br>${esc(extra)}` : ''}</p><p><a href="${esc(url)}">${esc(url)}</a></p></div>`,
  });
}

async function sendConfirmation({ to, name, title, score, lang = 'id', certNote }) {
  const t = T[lang] || T.id;
  const line = score ? t.score(score.score, score.max, score.percent) : '';
  await getTransport().sendMail({
    from: config.SMTP.from, to, subject: t.confSubject(title),
    text: `${t.confHi(name)}\n\n${t.confBody(title)}${line ? `\n${line}` : ''}${certNote ? `\n${t.certNote}` : ''}\n\n${config.ORG_NAME}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#1d1d1f"><p>${esc(t.confHi(name))}</p>
      <p>${esc(t.confBody(title))}</p>${line ? `<p style="background:#f5f5f7;border-radius:12px;padding:12px 16px"><b>${esc(line)}</b></p>` : ''}
      ${certNote ? `<p>${esc(t.certNote)}</p>` : ''}<p style="color:#6e6e73;font-size:13px">${esc(config.ORG_NAME)}</p></div>`,
  });
}

module.exports = { sendCertificate, sendOwnerNotice, sendConfirmation, configured };
