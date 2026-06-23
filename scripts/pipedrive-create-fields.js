// scripts/pipedrive-create-fields.js — cria campos customizados no Pipedrive se não existirem.
// Uso: npm run create:pdfields  (requer .env.local)
// SOMENTE criação idempotente. Não deleta nem modifica campos existentes.

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
    `\nUse: node --env-file=.env.local scripts/pipedrive-create-fields.js\n`
  );
  process.exit(1);
}

const TOKEN  = process.env.PIPEDRIVE_API_TOKEN;
const DOMAIN = process.env.PIPEDRIVE_COMPANY_DOMAIN;

if (!TOKEN || !DOMAIN) {
  console.error('ERRO: Defina PIPEDRIVE_API_TOKEN e PIPEDRIVE_COMPANY_DOMAIN em .env.local');
  process.exit(1);
}

const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

function safeUrl(u) {
  try {
    const url = new URL(u instanceof URL ? u.href : u);
    if (url.searchParams.has('api_token')) url.searchParams.set('api_token', '[REDACTED]');
    return url.toString();
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

async function get(path, params = {}) {
  const u = buildUrl(path, params);
  console.log(`  GET ${safeUrl(u)}`);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} em GET ${safeUrl(u)}`);
  const json = await res.json();
  if (!json.success) throw new Error(`API error em GET ${path}: ${JSON.stringify(json.error ?? '?')}`);
  return json;
}

async function post(path, body) {
  const u = buildUrl(path);
  console.log(`  POST ${safeUrl(u)}`);
  const res = await fetch(u.toString(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} em POST ${path}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(`API error em POST ${path}: ${JSON.stringify(json.error ?? '?')}`);
  return json;
}

async function getAllDealFields() {
  const items = [];
  let start = 0;
  while (true) {
    const json = await get('/dealFields', { limit: 500, start });
    if (Array.isArray(json.data)) items.push(...json.data);
    const next = json.additional_data?.pagination?.next_start;
    if (next == null || next <= start) break;
    start = next;
  }
  return items;
}

// ── Campos a garantir ────────────────────────────────────────────────────────────
const TARGET_FIELDS = [
  { name: 'Live - campaign_id',  envVar: 'PIPEDRIVE_FIELD_CAMPAIGN_ID'  },
  { name: 'Live - utm_source',   envVar: 'PIPEDRIVE_FIELD_UTM_SOURCE'   },
  { name: 'Live - utm_medium',   envVar: 'PIPEDRIVE_FIELD_UTM_MEDIUM'   },
  { name: 'Live - utm_campaign', envVar: 'PIPEDRIVE_FIELD_UTM_CAMPAIGN' },
  { name: 'Live - gclid',        envVar: 'PIPEDRIVE_FIELD_GCLID'        },
];

// ── Main ────────────────────────────────────────────────────────────────────────
console.log('\n🔧 Pipedrive — criar campos customizados (idempotente)\n');

try {
  console.log('▸ Carregando deal fields existentes...');
  const existing = await getAllDealFields();
  const byName   = new Map(existing.map(f => [f.name, f]));

  const results = [];

  for (const target of TARGET_FIELDS) {
    if (byName.has(target.name)) {
      const field = byName.get(target.name);
      console.log(`  ✅ "${target.name}" já existe  →  key=${field.key}`);
      results.push({ ...target, key: field.key, action: 'existing' });
    } else {
      console.log(`  ➕ Criando "${target.name}"...`);
      const json = await post('/dealFields', { name: target.name, field_type: 'varchar' });
      const key  = json.data.key;
      console.log(`     → key=${key}`);
      results.push({ ...target, key, action: 'created' });
    }
  }

  console.log('\n✅ Concluído.\n');
  console.log('── COLE NO .env.local E nas env vars do Vercel ───────────────────');
  for (const r of results) {
    console.log(`${r.envVar}=${r.key}`);
  }
  console.log('──────────────────────────────────────────────────────────────────\n');

  mkdirSync(join(ROOT, 'discovery', 'output'), { recursive: true });
  writeFileSync(
    join(ROOT, 'discovery', 'output', 'pipedrive-fields.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), fields: results }, null, 2)
  );
  console.log('Detalhes gravados em discovery/output/pipedrive-fields.json\n');

} catch (err) {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
}
