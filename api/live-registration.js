// api/live-registration.js — Vercel Serverless Function (Node 20+)
// Fase 1: valida, normaliza, loga estruturado e redireciona.
// TODOs marcados para Fases 2-4 (Pipedrive, Mailchimp, ManyChat, tracking).

import crypto from 'node:crypto';

// ─── Rate limit em memória (reinicia a cada cold start) ───────────────────────
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RATE_MAX       = 5;
const ipMap          = new Map();       // ip → { count, windowStart }

function isRateLimited(ip) {
  const now  = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    ipMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) return true;
  return false;
}

// ─── Utilitários ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
}

/** Normaliza para E.164 (Brasil +55 como default). Remove não-dígitos. */
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+55' + digits;
  return '+' + digits; // melhor esforço
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
  const campaignIdEnv = process.env.CAMPAIGN_ID    || 'live-dia-consultor-2026';

  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(allowedOrigin));
    return res.end();
  }

  // ── Método ──
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST, OPTIONS', ...corsHeaders(allowedOrigin) });
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  // ── Rate limit ──
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    res.writeHead(429, corsHeaders(allowedOrigin));
    return res.end(JSON.stringify({ ok: false, error: 'Too many requests' }));
  }

  // ── Leitura e parse do body ──
  // O runtime da Vercel pode já ter parseado req.body (objeto ou string).
  // Só lemos o stream como fallback quando req.body está ausente.
  const MAX_BYTES = 8 * 1024;
  let body;
  try {
    if (req.body !== undefined && req.body !== null) {
      // Vercel já parseou: pode ser objeto ou string
      body = (typeof req.body === 'object') ? req.body : JSON.parse(req.body);
    } else {
      // Fallback: lê stream manualmente
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BYTES) {
          res.writeHead(413, corsHeaders(allowedOrigin));
          return res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
        }
      }
      if (!raw) {
        res.writeHead(400, corsHeaders(allowedOrigin));
        return res.end(JSON.stringify({ ok: false, error: 'Empty body' }));
      }
      body = JSON.parse(raw);
    }

    // Verifica tamanho mesmo quando veio via req.body (serializa para medir)
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) {
      res.writeHead(413, corsHeaders(allowedOrigin));
      return res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
    }
  } catch {
    res.writeHead(400, corsHeaders(allowedOrigin));
    return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
  }

  // ── Honeypot ──
  if (body._hp) {
    // Bot: responde ok mas descarta silenciosamente
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) });
    return res.end(JSON.stringify({ ok: true, redirect: '/obrigado.html' }));
  }

  // ── Validação ──
  const errors = {};

  const fullname = (body.fullname || '').trim();
  if (!fullname || fullname.length < 2 || fullname.length > 120)
    errors.fullname = 'Nome deve ter entre 2 e 120 caracteres.';

  const emailRaw = (body.email || '').trim().toLowerCase();
  if (!emailRaw || !EMAIL_RE.test(emailRaw))
    errors.email = 'E-mail inválido.';

  const phone = (body.phone || '').trim();
  if (!phone)
    errors.phone = 'Telefone obrigatório.';

  const company = (body.company || '').trim();
  if (!company || company.length > 120)
    errors.company = 'Empresa/Consultoria obrigatória (máx. 120 chars).';

  const campaignId   = (body.campaign_id   || '').trim();
  const submissionId = (body.submission_id || '').trim();

  if (campaignId !== campaignIdEnv)
    errors.campaign_id = 'campaign_id inválido.';

  if (!submissionId || !UUID_RE.test(submissionId))
    errors.submission_id = 'submission_id inválido ou ausente.';

  if (Object.keys(errors).length > 0) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) });
    return res.end(JSON.stringify({ ok: false, error: 'Validation failed', fields: errors }));
  }

  // ── Normalização ──
  const normalizedPhone = normalizePhone(phone);
  const registeredAt    = new Date().toISOString();
  const leadKey         = `${campaignId}:${emailRaw}`; // uso interno/deduplicação, não vai ao log
  const leadKeyHash     = crypto.createHash('sha256').update(leadKey).digest('hex').slice(0, 16);

  // Allowlist de campos opcionais de tracking
  const TRACKING_FIELDS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','landing_page'];
  const tracking = {};
  for (const f of TRACKING_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') tracking[f] = String(body[f]).slice(0, 500);
  }

  // ── Log estruturado (sem PII completa) ──
  console.log(JSON.stringify({
    level:          'info',
    event:          'lead_received',
    submission_id:  submissionId,
    campaign_id:    campaignId,
    email_masked:   maskEmail(emailRaw),
    lead_key_hash:  leadKeyHash,   // sha256(campaign_id:email)[0..16] — correlação sem expor e-mail
    utm_source:     tracking.utm_source    || '',
    utm_medium:     tracking.utm_medium    || '',
    utm_campaign:   tracking.utm_campaign  || '',
    fbclid:         tracking.fbclid        || '',
    gclid:          tracking.gclid         || '',
    landing_page:   tracking.landing_page  || '',
    registered_at:  registeredAt,
    status:         'ok',
  }));

  // ── TODO Fase 2: Pipedrive — criar Deal/Person ─────────────────────────────
  // await createPipedriveDeal({ fullname, email: emailRaw, phone: normalizedPhone, company, leadKey, submissionId, ...tracking });

  // ── TODO Fase 3: Mailchimp — subscribe + tag ───────────────────────────────
  // await subscribeMailchimp({ email: emailRaw, fullname, tags: [campaignId], ...tracking });

  // ── TODO Fase 4: ManyChat — vincular subscriber + UTMs ─────────────────────
  // await manyChatLink({ phone: normalizedPhone, submissionId, ...tracking });

  // ── TODO Fase 5: Meta CAPI — enviar evento Lead com submission_id como event_id
  // await sendMetaCAPI({ event_id: submissionId, email: emailRaw, phone: normalizedPhone, ...tracking });

  // ── Resposta de sucesso ──
  res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) });
  return res.end(JSON.stringify({
    ok:             true,
    lead_key_hash:  leadKeyHash,
    submission_id:  submissionId,
    redirect:       '/obrigado.html',
  }));
}
