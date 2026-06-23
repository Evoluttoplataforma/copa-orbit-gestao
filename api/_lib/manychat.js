// api/_lib/manychat.js — helper ManyChat API (ESM, Node 20+)
// Importado por live-registration.js quando ENABLE_MANYCHAT=true.
// REGRAS: nunca logar o token nem o header Authorization.

const TOKEN = process.env.MANYCHAT_API_TOKEN || '';
const TAG   = process.env.MANYCHAT_TAG       || '';

const BASE       = 'https://api.manychat.com';
const TIMEOUT_MS = 8_000;

// Header de autenticação — buildado uma vez, nunca logado
const AUTH = TOKEN ? `Bearer ${TOKEN}` : '';

// ── fetch com timeout (8 s) e retry em 5xx/timeout ──────────────────────────────
async function mcFetch(url, init = {}, attemptsLeft = 2) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: AUTH, ...init.headers },
      signal:  ctrl.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    if (attemptsLeft > 1) return mcFetch(url, init, attemptsLeft - 1);
    throw new Error(err.name === 'AbortError' ? 'manychat_timeout' : `manychat_network: ${err.message}`);
  }
  clearTimeout(tid);
  if (res.status >= 500 && attemptsLeft > 1) return mcFetch(url, init, attemptsLeft - 1);
  return res;
}

function httpErr(msg, status) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// ── Ponto de entrada público ──────────────────────────────────────────────────────

export async function linkAndTag({ fullname, phoneE164 }) {
  if (!TOKEN || !TAG) {
    throw new Error('MANYCHAT: MANYCHAT_API_TOKEN e MANYCHAT_TAG são obrigatórios');
  }

  const parts     = fullname.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.slice(1).join(' ') || undefined;

  // 1. Buscar contato por telefone
  let subscriberId = null;
  const findRes    = await mcFetch(
    `${BASE}/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phoneE164)}`
  );

  if (findRes.status === 404) {
    // Não encontrado — seguir para criar
  } else if (!findRes.ok) {
    const text = await findRes.text().catch(() => '');
    throw httpErr(
      `manychat findBySystemField → HTTP ${findRes.status}: ${text.slice(0, 200)}`,
      findRes.status
    );
  } else {
    const json   = await findRes.json().catch(() => ({}));
    subscriberId = json.data?.id ?? null;
    if (subscriberId) {
      console.log(JSON.stringify({
        level: 'info', event: 'manychat_subscriber_found', subscriber_id: subscriberId,
      }));
    }
  }

  // 2. Criar se não encontrado
  if (!subscriberId) {
    const createBody = { whatsapp_phone: phoneE164, first_name: firstName };
    if (lastName) createBody.last_name = lastName;

    const createRes = await mcFetch(`${BASE}/fb/subscriber/createSubscriber`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      throw httpErr(
        `manychat createSubscriber → HTTP ${createRes.status}: ${text.slice(0, 200)}`,
        createRes.status
      );
    }

    const createJson = await createRes.json().catch(() => ({}));
    subscriberId     = createJson.data?.id ?? null;

    if (!subscriberId) {
      throw new Error('manychat createSubscriber: subscriber_id ausente na resposta');
    }
    console.log(JSON.stringify({
      level: 'info', event: 'manychat_subscriber_created', subscriber_id: subscriberId,
    }));
  }

  // 3. Aplicar tag por nome (idempotente)
  const tagRes = await mcFetch(`${BASE}/fb/subscriber/addTagByName`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ subscriber_id: subscriberId, tag_name: TAG }),
  });

  if (!tagRes.ok) {
    const text = await tagRes.text().catch(() => '');
    throw httpErr(
      `manychat addTagByName → HTTP ${tagRes.status}: ${text.slice(0, 200)}`,
      tagRes.status
    );
  }

  return 'ok';
}
