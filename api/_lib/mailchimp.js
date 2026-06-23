// api/_lib/mailchimp.js — helper Mailchimp Marketing API v3 (ESM, Node 20+)
// Importado por live-registration.js quando ENABLE_MAILCHIMP=true.
// REGRAS: nunca logar API key, nunca logar Authorization header.

import crypto from 'node:crypto';

const API_KEY = process.env.MAILCHIMP_API_KEY || '';
const LIST_ID = process.env.MAILCHIMP_LIST_ID || '';
const TAG     = process.env.MAILCHIMP_TAG     || '';

// Prefixo do servidor: env var explícita ou sufixo da key (ex.: "xxxx-us2" → "us2")
const PREFIX = process.env.MAILCHIMP_SERVER_PREFIX || API_KEY.split('-').pop() || '';
const BASE   = `https://${PREFIX}.api.mailchimp.com/3.0`;

// Header de autenticação — buildado uma vez, nunca logado
const AUTH = API_KEY
  ? 'Basic ' + Buffer.from(`anystring:${API_KEY}`).toString('base64')
  : '';

const TIMEOUT_MS = 8_000;

// ── MD5 do e-mail lowercase (chave de membro no Mailchimp) ──────────────────────
function subscriberHash(email) {
  return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
}

// ── fetch com timeout (8 s) e retry em 5xx/timeout ──────────────────────────────
async function mcFetch(url, init = {}, attemptsLeft = 2) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: AUTH },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    if (attemptsLeft > 1) return mcFetch(url, init, attemptsLeft - 1);
    throw new Error(err.name === 'AbortError' ? 'mailchimp_timeout' : `mailchimp_network: ${err.message}`);
  }
  clearTimeout(tid);
  if (res.status >= 500 && attemptsLeft > 1) return mcFetch(url, init, attemptsLeft - 1);
  return res;
}

// ── Ponto de entrada público ──────────────────────────────────────────────────────

export async function subscribeAndTag({ email, fullname, phone, company }) {
  if (!API_KEY || !LIST_ID || !PREFIX) {
    throw new Error('MAILCHIMP: API_KEY, LIST_ID e PREFIX são obrigatórios');
  }

  const hash      = subscriberHash(email);
  const firstName = fullname.trim().split(/\s+/)[0];

  // 1. Upsert do membro (PUT — idempotente; não duplica em reenvio)
  const putUrl = `${BASE}/lists/${LIST_ID}/members/${hash}`;
  const putRes = await mcFetch(putUrl, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      merge_fields: {
        FNAME:   firstName,
        PHONE:   phone,
        COMPANY: company,
      },
    }),
  });

  if (!putRes.ok) {
    if (putRes.status === 400) {
      const body  = await putRes.json().catch(() => ({}));
      const title = (body.title || '').toLowerCase();
      // Contato em compliance state (unsubscribed/cleaned) — não pode ser
      // re-inscrito via API; tratar como aviso, não como erro fatal.
      if (title.includes('compliance') || title.includes('forgotten') || title.includes('unsubscribed')) {
        console.log(JSON.stringify({
          level: 'warn', event: 'mailchimp_contact_compliance', status: 400,
          detail: body.title ?? 'compliance state',
        }));
        return 'skipped_unsubscribed';
      }
      throw new Error(`mailchimp PUT member → HTTP 400: ${body.title ?? body.detail ?? JSON.stringify(body).slice(0, 200)}`);
    }
    const text = await putRes.text().catch(() => '');
    throw new Error(`mailchimp PUT member → HTTP ${putRes.status}: ${text.slice(0, 200)}`);
  }

  // 2. Aplicar tag (POST — idempotente quando status:'active')
  if (TAG) {
    const tagUrl = `${BASE}/lists/${LIST_ID}/members/${hash}/tags`;
    const tagRes = await mcFetch(tagUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tags: [{ name: TAG, status: 'active' }] }),
    });
    if (!tagRes.ok) {
      const text = await tagRes.text().catch(() => '');
      throw new Error(`mailchimp POST tags → HTTP ${tagRes.status}: ${text.slice(0, 200)}`);
    }
  }

  return 'ok';
}
