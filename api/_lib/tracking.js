// api/_lib/tracking.js — conversões server-side: Meta CAPI + GA4 MP (ESM, Node 20+)
// REGRAS: nunca logar access_token, api_secret nem PII (e-mail, telefone em claro).

import crypto from 'node:crypto';

const META_PIXEL_ID        = process.env.META_PIXEL_ID        || '';
const META_CAPI_TOKEN      = process.env.META_CAPI_TOKEN      || '';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';
const GA4_MEASUREMENT_ID   = process.env.GA4_MEASUREMENT_ID   || '';
const GA4_API_SECRET       = process.env.GA4_API_SECRET       || '';

const TIMEOUT_MS = 8_000;

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Mascara credenciais em query-strings antes de qualquer log
function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('access_token')) u.searchParams.set('access_token', '[REDACTED]');
    if (u.searchParams.has('api_secret'))   u.searchParams.set('api_secret',   '[REDACTED]');
    return u.toString();
  } catch {
    return '[url-inválida]';
  }
}

// ── fetch com timeout (8s) e retry em 5xx/timeout ──────────────────────────────
async function tkFetch(url, init = {}, attemptsLeft = 2) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(tid);
    if (attemptsLeft > 1) return tkFetch(url, init, attemptsLeft - 1);
    throw new Error(err.name === 'AbortError' ? 'tracking_timeout' : `tracking_network: ${err.message}`);
  }
  clearTimeout(tid);
  if (res.status >= 500 && attemptsLeft > 1) return tkFetch(url, init, attemptsLeft - 1);
  return res;
}

// ── Meta CAPI ──────────────────────────────────────────────────────────────────

async function sendMetaCAPI({ email, phone, fbclid, fbp, clientIp, userAgent, submissionId, landingPage }) {
  const url = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`;

  const user_data = {
    em: [sha256(email.trim().toLowerCase())],
    ph: [sha256(phone.replace(/\D/g, ''))],
  };
  if (fbclid)    user_data.fbc               = `fb.1.${Date.now()}.${fbclid}`;
  if (fbp)       user_data.fbp               = fbp;
  if (clientIp)  user_data.client_ip_address = clientIp;
  if (userAgent) user_data.client_user_agent = userAgent;

  const event = {
    event_name:       'Lead',
    event_time:       Math.floor(Date.now() / 1000),
    event_id:         submissionId,
    action_source:    'website',
    event_source_url: landingPage || '',
    user_data,
  };

  const body = { data: [event] };
  if (META_TEST_EVENT_CODE) body.test_event_code = META_TEST_EVENT_CODE;

  console.log(JSON.stringify({
    level: 'info', event: 'meta_capi_sending',
    url:   safeUrl(url), submission_id: submissionId,
  }));

  const res = await tkFetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`meta_capi → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ── GA4 Measurement Protocol ──────────────────────────────────────────────────

async function sendGA4({ clientId, submissionId, params: p = {} }) {
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

  const evParams = { transaction_id: submissionId };
  const UTM_KEYS = ['campaign_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'];
  for (const k of UTM_KEYS) {
    if (p[k]) evParams[k] = p[k];
  }

  console.log(JSON.stringify({
    level: 'info', event: 'ga4_mp_sending',
    url:   safeUrl(url), submission_id: submissionId,
  }));

  const res = await tkFetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id: clientId || submissionId,
      events:    [{ name: 'generate_lead', params: evParams }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ga4_mp → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ── Ponto de entrada público ──────────────────────────────────────────────────

export async function sendConversions({ email, phone, fbclid, fbp, clientId, clientIp, userAgent, submissionId, landingPage, params }) {
  let meta = 'skipped';
  let ga4  = 'skipped';

  if (META_PIXEL_ID && META_CAPI_TOKEN) {
    try {
      await sendMetaCAPI({ email, phone, fbclid, fbp, clientIp, userAgent, submissionId, landingPage });
      meta = 'ok';
      console.log(JSON.stringify({ level: 'info', event: 'meta_capi_ok', submission_id: submissionId }));
    } catch (err) {
      meta = 'retry';
      console.log(JSON.stringify({
        level: 'warn', event: 'meta_capi_failed', submission_id: submissionId, error: err.message,
      }));
    }
  }

  if (GA4_MEASUREMENT_ID && GA4_API_SECRET) {
    try {
      await sendGA4({ clientId, submissionId, params });
      ga4 = 'ok';
      console.log(JSON.stringify({ level: 'info', event: 'ga4_mp_ok', submission_id: submissionId }));
    } catch (err) {
      ga4 = 'retry';
      console.log(JSON.stringify({
        level: 'warn', event: 'ga4_mp_failed', submission_id: submissionId, error: err.message,
      }));
    }
  }

  return { meta, ga4 };
}
