// scripts/pipedrive-discovery.js — SOMENTE LEITURA. Sem escrita, sem side-effects.
// Uso: npm run discover:pipedrive  (requer .env.local)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname }            from 'node:path';
import { fileURLToPath }            from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── Node >= 20.6 obrigatório para --env-file ────────────────────────────────────
const [major, minor] = process.version.slice(1).split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) {
  console.error(
    `\nERRO: Node >= 20.6 necessário para --env-file (você tem ${process.version}).` +
    `\nUse: node --env-file=.env.local scripts/pipedrive-discovery.js\n`
  );
  process.exit(1);
}

// ── Env vars ────────────────────────────────────────────────────────────────────
const TOKEN  = process.env.PIPEDRIVE_API_TOKEN;
const DOMAIN = process.env.PIPEDRIVE_COMPANY_DOMAIN;

if (!TOKEN || !DOMAIN) {
  console.error('ERRO: Defina PIPEDRIVE_API_TOKEN e PIPEDRIVE_COMPANY_DOMAIN em .env.local');
  process.exit(1);
}

const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

// ── safeUrl: nunca logar api_token nem qualquer credencial ──────────────────────
function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('api_token')) u.searchParams.set('api_token', '[REDACTED]');
    return u.toString();
  } catch {
    return '[url-inválida]';
  }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────────
async function get(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  console.log(`  GET ${safeUrl(url.toString())}`);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${safeUrl(url.toString())}`);
  const json = await res.json();
  if (!json.success) throw new Error(`API error em ${path}: ${JSON.stringify(json.error)}`);
  return json;
}

async function getAll(path, params = {}) {
  const items = [];
  let start = 0;
  while (true) {
    const json = await get(path, { ...params, limit: 500, start });
    if (Array.isArray(json.data)) items.push(...json.data);
    const next = json.additional_data?.pagination?.next_start;
    if (next == null || next <= start) break;
    start = next;
  }
  return items;
}

// ── Campos necessários para a integração ────────────────────────────────────────
const REQUIRED_FIELDS = [
  'campaign_id', 'submission_id',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'landing_page', 'lead_key_hash',
];
const REQUIRED_STAGE = 'Inscrito na Live';
const REQUIRED_LABEL = 'Live Dia do Consultor 2026';

// ── Main ────────────────────────────────────────────────────────────────────────
console.log('\n🔍 Pipedrive Discovery — somente leitura\n');

try {
  console.log('▸ Pipelines...');
  const pipelines = await getAll('/pipelines');

  console.log('▸ Estágios...');
  const stages = await getAll('/stages');

  console.log('▸ Usuários (id+nome apenas)...');
  const usersRaw = await getAll('/users');
  const users = usersRaw.map(u => ({ id: u.id, name: u.name })); // sem e-mail no output

  console.log('▸ Deal fields...');
  const dealFields = await getAll('/dealFields');

  console.log('▸ Person fields...');
  const personFields = await getAll('/personFields');

  console.log('▸ Organization fields...');
  const organizationFields = await getAll('/organizationFields');

  console.log('▸ Moedas...');
  const currencies = await getAll('/currencies');

  // Labels: são options do deal field com key === 'label'
  const labelField = dealFields.find(f => f.key === 'label');
  const labels     = labelField?.options || [];

  // Análise de presença dos campos necessários
  const dealFieldKeys  = dealFields.map(f => f.key);
  const presentFields  = REQUIRED_FIELDS.filter(k =>  dealFieldKeys.includes(k));
  const missingFields  = REQUIRED_FIELDS.filter(k => !dealFieldKeys.includes(k));

  const hasRequiredStage = stages.some(
    s => s.name.toLowerCase() === REQUIRED_STAGE.toLowerCase()
  );
  const hasRequiredLabel = labels.some(
    l => (l.label || l.name || '').toLowerCase() === REQUIRED_LABEL.toLowerCase()
  );

  // Output — sem tokens, sem e-mails de owners
  const output = {
    generated_at: new Date().toISOString(),
    pipelines: pipelines.map(p => ({ id: p.id, name: p.name, active: p.active })),
    stages: stages.map(s => ({
      id: s.id, name: s.name, pipeline_id: s.pipeline_id, order_nr: s.order_nr,
    })),
    users,
    currencies: currencies.map(c => ({ id: c.id, code: c.code, name: c.name })),
    deal_fields: dealFields.map(f => ({
      id: f.id, key: f.key, name: f.name, field_type: f.field_type,
    })),
    person_fields: personFields.map(f => ({
      id: f.id, key: f.key, name: f.name, field_type: f.field_type,
    })),
    organization_fields: organizationFields.map(f => ({
      id: f.id, key: f.key, name: f.name, field_type: f.field_type,
    })),
    labels: labels.map(l => ({ id: l.id, label: l.label || l.name || '' })),
    analysis: {
      required_deal_fields:  REQUIRED_FIELDS,
      present_deal_fields:   presentFields,
      missing_deal_fields:   missingFields,
      required_stage:        REQUIRED_STAGE,
      stage_present:         hasRequiredStage,
      required_label:        REQUIRED_LABEL,
      label_present:         hasRequiredLabel,
    },
  };

  mkdirSync(join(ROOT, 'discovery', 'output'), { recursive: true });
  writeFileSync(
    join(ROOT, 'discovery', 'output', 'pipedrive.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\n✅ discovery/output/pipedrive.json gravado.\n');
  console.log('── ANÁLISE ──────────────────────────────────────────────────');
  console.log('Pipelines e estágios:');
  for (const p of output.pipelines) {
    const pStages = output.stages.filter(s => s.pipeline_id === p.id);
    console.log(`  [${p.id}] ${p.name}`);
    for (const s of pStages) console.log(`       ├─ [${s.id}] ${s.name}`);
  }
  console.log(`\nEstágio "${REQUIRED_STAGE}": ${hasRequiredStage ? '✅ encontrado' : '❌ AUSENTE — criar manualmente'}`);
  console.log(`Label "${REQUIRED_LABEL}":  ${hasRequiredLabel ? '✅ encontrada' : '❌ AUSENTE — criar manualmente'}`);
  if (presentFields.length) console.log(`\nDeal fields presentes : ${presentFields.join(', ')}`);
  if (missingFields.length) console.log(`Deal fields AUSENTES  : ${missingFields.join(', ')} ← criar na Fase 2`);
  console.log('\nVeja discovery/output/pipedrive.json para todos os IDs.\n');

} catch (err) {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
}
