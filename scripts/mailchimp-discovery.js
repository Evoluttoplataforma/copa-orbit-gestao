// scripts/mailchimp-discovery.js — SOMENTE LEITURA. Sem escrita, sem side-effects.
// Uso: npm run discover:mailchimp  (requer .env.local)

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
    `\nUse: node --env-file=.env.local scripts/mailchimp-discovery.js\n`
  );
  process.exit(1);
}

// ── Env vars ────────────────────────────────────────────────────────────────────
const API_KEY = process.env.MAILCHIMP_API_KEY;
if (!API_KEY) {
  console.error('ERRO: Defina MAILCHIMP_API_KEY em .env.local');
  process.exit(1);
}

// O prefixo do servidor está no sufixo da chave: "xxxx-us21" → "us21"
const serverPrefix = process.env.MAILCHIMP_SERVER_PREFIX || API_KEY.split('-').pop();
const BASE         = `https://${serverPrefix}.api.mailchimp.com/3.0`;
// Auth: Basic anystring:<api_key> — chave não aparece em URLs, somente no header
const AUTH = 'Basic ' + Buffer.from(`anystring:${API_KEY}`).toString('base64');

// ── HTTP helper ─────────────────────────────────────────────────────────────────
async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  console.log(`  GET ${url.toString()}`);
  const res = await fetch(url.toString(), { headers: { Authorization: AUTH } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} em ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Merge tags que precisamos para a integração ─────────────────────────────────
const REQUIRED_TAGS = ['FNAME', 'PHONE', 'COMPANY', 'ZOOMLINK', 'LIVE_DATE', 'LIVE_TIME'];

// ── Main ────────────────────────────────────────────────────────────────────────
console.log('\n🔍 Mailchimp Discovery — somente leitura\n');

try {
  console.log('▸ Audiências (lists)...');
  const listsData = await get('/lists', {
    count:  1000,
    fields: 'lists.id,lists.name,lists.stats.member_count,total_items',
  });
  const audiences = listsData.lists || [];
  console.log(`  Encontradas: ${audiences.length}`);

  const audienceDetails = [];

  for (const aud of audiences) {
    console.log(`\n  ── Audiência: ${aud.name} (${aud.id}) ──`);

    // Merge fields
    console.log('  ▸ Merge fields...');
    const mfData     = await get(`/lists/${aud.id}/merge-fields`, { count: 1000 });
    const mergeFields = mfData.merge_fields || [];
    const presentTags = mergeFields.map(f => f.tag);
    const missingTags = REQUIRED_TAGS.filter(t => !presentTags.includes(t));

    // Segmentos estáticos (tags de lista)
    console.log('  ▸ Segmentos estáticos...');
    let segments = [];
    try {
      const segData = await get(`/lists/${aud.id}/segments`, {
        type:   'static',
        count:  1000,
        fields: 'segments.id,segments.name,segments.member_count,total_items',
      });
      segments = segData.segments || [];
    } catch (e) {
      console.log(`    Aviso: não foi possível listar segmentos — ${e.message}`);
    }

    audienceDetails.push({
      id:           aud.id,
      name:         aud.name,
      member_count: aud.stats?.member_count ?? null,
      merge_fields: mergeFields.map(f => ({
        id:       f.merge_id,
        tag:      f.tag,
        name:     f.name,
        type:     f.type,
        required: f.required,
      })),
      segments: segments.map(s => ({
        id:           s.id,
        name:         s.name,
        member_count: s.member_count,
      })),
      analysis: {
        required_tags: REQUIRED_TAGS,
        present_tags:  REQUIRED_TAGS.filter(t =>  presentTags.includes(t)),
        missing_tags:  missingTags,
      },
    });
  }

  const output = {
    generated_at: new Date().toISOString(),
    server_prefix: serverPrefix,
    audiences: audienceDetails,
  };

  mkdirSync(join(ROOT, 'discovery', 'output'), { recursive: true });
  writeFileSync(
    join(ROOT, 'discovery', 'output', 'mailchimp.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\n✅ discovery/output/mailchimp.json gravado.\n');
  console.log('── ANÁLISE ──────────────────────────────────────────────────');
  for (const aud of audienceDetails) {
    console.log(`\nAudiência: ${aud.name} (${aud.id}) — ${aud.member_count ?? '?'} contatos`);
    if (aud.analysis.present_tags.length)
      console.log(`  Merge tags presentes : ${aud.analysis.present_tags.join(', ')}`);
    if (aud.analysis.missing_tags.length)
      console.log(`  Merge tags AUSENTES  : ${aud.analysis.missing_tags.join(', ')} ← criar na Fase 3`);
    if (aud.segments.length)
      console.log(`  Segmentos (${aud.segments.length}): ${aud.segments.slice(0, 5).map(s => s.name).join(', ')}${aud.segments.length > 5 ? '…' : ''}`);
  }
  console.log('\nVeja discovery/output/mailchimp.json para todos os IDs.\n');

} catch (err) {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
}
