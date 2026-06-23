// api/_lib/pipedrive.js — helper Pipedrive API v1 (ESM, Node 20+)
// Importado por live-registration.js quando ENABLE_PIPEDRIVE=true.
// REGRAS: nunca logar token, nunca logar URL crua, sem PII completa no console.

const TOKEN       = process.env.PIPEDRIVE_API_TOKEN      || '';
const DOMAIN      = process.env.PIPEDRIVE_COMPANY_DOMAIN || '';
const PIPELINE_ID = process.env.PIPEDRIVE_PIPELINE_ID    || '';
const STAGE_ID    = process.env.PIPEDRIVE_STAGE_ID       || '';
const LABEL_ID    = process.env.PIPEDRIVE_LABEL_ID       || '';
const OWNER_ID    = process.env.PIPEDRIVE_OWNER_ID       || '';

// Chaves de campos customizados de UTM — preenchidas após rodar create:pdfields
const FIELD_CAMPAIGN_ID  = process.env.PIPEDRIVE_FIELD_CAMPAIGN_ID  || '';
const FIELD_UTM_SOURCE   = process.env.PIPEDRIVE_FIELD_UTM_SOURCE   || '';
const FIELD_UTM_MEDIUM   = process.env.PIPEDRIVE_FIELD_UTM_MEDIUM   || '';
const FIELD_UTM_CAMPAIGN = process.env.PIPEDRIVE_FIELD_UTM_CAMPAIGN || '';
const FIELD_GCLID        = process.env.PIPEDRIVE_FIELD_GCLID        || '';

const BASE              = `https://${DOMAIN}.pipedrive.com/api/v1`;
const TIMEOUT_MS        = 8_000;
const DEAL_TITLE_PREFIX = 'Live Dia do Consultor 2026 —';

// ── safeUrl: mascara api_token antes de qualquer log ─────────────────────────────
function safeUrl(urlObj) {
  try {
    const u = new URL(urlObj instanceof URL ? urlObj.href : String(urlObj));
    if (u.searchParams.has('api_token')) u.searchParams.set('api_token', '[REDACTED]');
    return u.toString();
  } catch {
    return '[url-inválida]';
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE + path);
  u.searchParams.set('api_token', TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u;
}

// ── fetch com timeout (8 s) e retry automático em 5xx ou timeout ─────────────────
async function pdFetch(urlObj, init = {}, attemptsLeft = 2) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(urlObj.toString(), { ...init, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(tid);
    if (attemptsLeft > 1) return pdFetch(urlObj, init, attemptsLeft - 1);
    const msg = err.name === 'AbortError' ? 'pipedrive_timeout' : `pipedrive_network: ${err.message}`;
    throw new Error(msg);
  }
  clearTimeout(tid);
  if (res.status >= 500 && attemptsLeft > 1) return pdFetch(urlObj, init, attemptsLeft - 1);
  return res;
}

function mkErr(msg, status, apiFailure = false) {
  const e = new Error(msg);
  e.status     = status;
  e.apiFailure = apiFailure;
  return e;
}

async function pdGet(path, params = {}) {
  const urlObj = buildUrl(path, params);
  const res    = await pdFetch(urlObj);
  if (!res.ok) throw mkErr(`GET ${safeUrl(urlObj)} → HTTP ${res.status}`, res.status);
  const json = await res.json();
  if (!json.success)
    throw mkErr(`GET ${safeUrl(urlObj)} → API error: ${JSON.stringify(json.error ?? json.message ?? '?')}`, res.status, true);
  return json;
}

async function pdPost(path, body) {
  const urlObj = buildUrl(path);
  const res    = await pdFetch(urlObj, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw mkErr(`POST ${safeUrl(urlObj)} → HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const json = await res.json();
  if (!json.success)
    throw mkErr(`POST ${safeUrl(urlObj)} → API error: ${JSON.stringify(json.error ?? json.message ?? '?')}`, res.status, true);
  return json;
}

async function pdPut(path, body) {
  const urlObj = buildUrl(path);
  const res    = await pdFetch(urlObj, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw mkErr(`PUT ${safeUrl(urlObj)} → HTTP ${res.status}`, res.status);
  return res.json();
}

// ── Pessoa (dedup e-mail → telefone → criar) ─────────────────────────────────────

async function resolveOrCreatePerson(fullname, email, phone) {
  const byEmail = await pdGet('/persons/search', {
    term: email, fields: 'email', exact_match: true, limit: 1,
  });
  if (byEmail.data?.items?.length) {
    const person = byEmail.data.items[0].item;
    console.log(JSON.stringify({ level: 'info', event: 'pipedrive_person_found', method: 'email', person_id: person.id }));
    return person;
  }

  const byPhone = await pdGet('/persons/search', {
    term: phone, fields: 'phone', exact_match: true, limit: 1,
  });
  if (byPhone.data?.items?.length) {
    const person = byPhone.data.items[0].item;
    console.log(JSON.stringify({ level: 'info', event: 'pipedrive_person_found', method: 'phone', person_id: person.id }));
    return person;
  }

  const created = await pdPost('/persons', {
    name:  fullname,
    email: [{ value: email, primary: true }],
    phone: [{ value: phone, primary: true }],
  });
  const person = created.data;
  console.log(JSON.stringify({ level: 'info', event: 'pipedrive_person_created', person_id: person.id }));
  return person;
}

// ── Organização (dedup nome → criar) ─────────────────────────────────────────────

async function resolveOrCreateOrg(company) {
  const search = await pdGet('/organizations/search', {
    term: company, exact_match: true, limit: 1,
  });
  if (search.data?.items?.length) {
    const org = search.data.items[0].item;
    console.log(JSON.stringify({ level: 'info', event: 'pipedrive_org_found', org_id: org.id }));
    return org;
  }

  const created = await pdPost('/organizations', { name: company });
  const org = created.data;
  console.log(JSON.stringify({ level: 'info', event: 'pipedrive_org_created', org_id: org.id }));
  return org;
}

// ── Vincular pessoa ↔ org (best-effort, não aborta em falha) ──────────────────────

async function linkPersonToOrg(personId, orgId) {
  try {
    await pdPut(`/persons/${personId}`, { org_id: orgId });
  } catch (err) {
    console.log(JSON.stringify({
      level: 'warn', event: 'pipedrive_link_person_org_failed',
      person_id: personId, org_id: orgId, status: err.status ?? null,
    }));
  }
}

// ── Deal (dedup prefixo de título → criar, com fallback de label) ─────────────────

async function resolveOrCreateDeal(personId, orgId, title, { campaignId = '', tracking = {} } = {}) {
  // Dedup: deal aberto que já pertença a esta campanha
  const dealsRes = await pdGet(`/persons/${personId}/deals`, { status: 'open', limit: 500 });
  if (Array.isArray(dealsRes.data)) {
    const dup = dealsRes.data.find(d => d.title.startsWith(DEAL_TITLE_PREFIX));
    if (dup) {
      console.log(JSON.stringify({ level: 'info', event: 'pipedrive_deal_duplicate', deal_id: dup.id, person_id: personId }));
      return { deal: dup, duplicate: true };
    }
  }

  const base = {
    title,
    person_id:   personId,
    org_id:      orgId,
    pipeline_id: Number(PIPELINE_ID),
    stage_id:    Number(STAGE_ID),
  };
  if (OWNER_ID) base.user_id = Number(OWNER_ID);

  // Campos customizados de UTM (somente se a env key estiver configurada)
  if (FIELD_CAMPAIGN_ID  && campaignId)             base[FIELD_CAMPAIGN_ID]  = campaignId;
  if (FIELD_UTM_SOURCE   && tracking.utm_source)    base[FIELD_UTM_SOURCE]   = tracking.utm_source;
  if (FIELD_UTM_MEDIUM   && tracking.utm_medium)    base[FIELD_UTM_MEDIUM]   = tracking.utm_medium;
  if (FIELD_UTM_CAMPAIGN && tracking.utm_campaign)  base[FIELD_UTM_CAMPAIGN] = tracking.utm_campaign;
  if (FIELD_GCLID        && tracking.gclid)         base[FIELD_GCLID]        = tracking.gclid;

  // Tenta com label, com fallback gracioso se o campo for rejeitado
  if (LABEL_ID) {
    const isLabelReject = e => e.status === 400 || e.status === 422 || e.apiFailure;

    try {
      const j = await pdPost('/deals', { ...base, label: LABEL_ID });
      console.log(JSON.stringify({ level: 'info', event: 'pipedrive_deal_created', deal_id: j.data.id, label: 'label' }));
      return { deal: j.data, duplicate: false };
    } catch (err) {
      if (!isLabelReject(err)) throw err;
      console.log(JSON.stringify({ level: 'warn', event: 'pipedrive_label_fallback', variant: 'label_ids' }));
    }

    try {
      const j = await pdPost('/deals', { ...base, label_ids: [LABEL_ID] });
      console.log(JSON.stringify({ level: 'info', event: 'pipedrive_deal_created', deal_id: j.data.id, label: 'label_ids' }));
      return { deal: j.data, duplicate: false };
    } catch (err) {
      if (!isLabelReject(err)) throw err;
      console.log(JSON.stringify({ level: 'warn', event: 'pipedrive_label_skipped', detail: 'criando deal sem label' }));
    }
  }

  // Sem label
  const j = await pdPost('/deals', base);
  console.log(JSON.stringify({ level: 'info', event: 'pipedrive_deal_created', deal_id: j.data.id, label: 'none' }));
  return { deal: j.data, duplicate: false };
}

// ── Nota estruturada (HTML simples, legível no Pipedrive) ─────────────────────────

function buildNoteContent({
  fullname, email, phone, company,
  campaignId, submissionId, leadKeyHash, registeredAt, tracking,
}) {
  const row = (k, v) => (v ? `<tr><td><b>${k}</b></td><td>${String(v)}</td></tr>` : '');
  return [
    '<h3>Live Dia do Consultor 2026 — Inscrição</h3>',
    '<table>',
    row('Nome',          fullname),
    row('E-mail',        email),
    row('Telefone',      phone),
    row('Consultoria',   company),
    '</table><hr/>',
    '<table>',
    row('campaign_id',   campaignId),
    row('submission_id', submissionId),
    row('lead_key_hash', leadKeyHash),
    row('registered_at', registeredAt),
    row('landing_page',  tracking.landing_page),
    row('utm_source',    tracking.utm_source),
    row('utm_medium',    tracking.utm_medium),
    row('utm_campaign',  tracking.utm_campaign),
    row('utm_content',   tracking.utm_content),
    row('utm_term',      tracking.utm_term),
    row('fbclid',        tracking.fbclid),
    row('gclid',         tracking.gclid),
    '</table>',
  ].join('\n');
}

// ── Ponto de entrada público ──────────────────────────────────────────────────────

export async function createPipedriveRecord({
  fullname, email, phone, company,
  submissionId, campaignId, leadKeyHash, registeredAt,
  tracking,
}) {
  if (!TOKEN || !DOMAIN || !PIPELINE_ID || !STAGE_ID) {
    throw new Error('PIPEDRIVE: TOKEN, DOMAIN, PIPELINE_ID e STAGE_ID são obrigatórios');
  }

  // 1. Pessoa
  const person = await resolveOrCreatePerson(fullname, email, phone);

  // 2. Organização
  const org    = await resolveOrCreateOrg(company);

  // 3. Vincular pessoa ↔ org (best-effort)
  await linkPersonToOrg(person.id, org.id);

  // 4. Deal
  const dealTitle           = `${DEAL_TITLE_PREFIX} ${fullname} (${company})`;
  const { deal, duplicate } = await resolveOrCreateDeal(person.id, org.id, dealTitle, { campaignId, tracking });

  if (duplicate) return 'duplicate';

  // 5. Nota (best-effort — falha não aborta o cadastro nem duplica o deal)
  try {
    const content = buildNoteContent({
      fullname, email, phone, company,
      campaignId, submissionId, leadKeyHash, registeredAt, tracking,
    });
    await pdPost('/notes', { deal_id: deal.id, content });
  } catch (err) {
    console.log(JSON.stringify({
      level: 'warn', event: 'pipedrive_note_failed',
      lead_key_hash: leadKeyHash, submission_id: submissionId,
      deal_id: deal.id, error: err.message,
    }));
    return 'ok_note_failed';
  }

  return 'ok';
}
