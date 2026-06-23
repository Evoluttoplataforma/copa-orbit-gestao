// scripts/manychat-discovery.js — SOMENTE LEITURA. Sem escrita, sem side-effects.
// Uso: npm run discover:manychat  (requer .env.local)

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
    `\nUse: node --env-file=.env.local scripts/manychat-discovery.js\n`
  );
  process.exit(1);
}

// ── Env vars ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.MANYCHAT_API_TOKEN;
if (!TOKEN) {
  console.error('ERRO: Defina MANYCHAT_API_TOKEN em .env.local');
  process.exit(1);
}

const BASE    = 'https://api.manychat.com';
// Token não aparece em URLs — somente no header Authorization
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// ── Tenta um endpoint e captura qualquer resultado ──────────────────────────────
async function tryGet(label, path) {
  const url = `${BASE}${path}`;
  console.log(`  GET ${url}`);
  try {
    const res  = await fetch(url, { headers: HEADERS });
    let json   = null;
    try { json = await res.json(); } catch { /* resposta não-JSON */ }

    return {
      label,
      endpoint: path,
      status:   res.status,
      ok:       res.ok,
      data:     res.ok ? json : null,
      error:    !res.ok
        ? `HTTP ${res.status}${json?.message ? ': ' + json.message : ''}`
        : null,
    };
  } catch (err) {
    return { label, endpoint: path, status: null, ok: false, data: null, error: err.message };
  }
}

// ── Endpoints para inspecionar ──────────────────────────────────────────────────
const ENDPOINTS = [
  { label: 'Página / conta',  path: '/fb/page/getInfo'         },
  { label: 'Flows',           path: '/fb/flow/getList'         },
  { label: 'Tags',            path: '/fb/tag/getList'          },
  { label: 'Custom fields',   path: '/fb/customField/getList'  },
  { label: 'OTNs',            path: '/fb/otn/getList'          },
];

// ── Main ────────────────────────────────────────────────────────────────────────
console.log('\n🔍 ManyChat Discovery — somente leitura\n');

const results = [];
for (const ep of ENDPOINTS) {
  console.log(`▸ ${ep.label}...`);
  const r = await tryGet(ep.label, ep.path);
  results.push(r);

  if (r.ok) {
    const count = Array.isArray(r.data?.data) ? ` (${r.data.data.length} itens)` : '';
    console.log(`  ✅ ${r.status} OK${count}`);
  } else if (r.status === 401) {
    console.log('  ❌ 401 Unauthorized — token inválido ou expirado');
  } else if (r.status === 403) {
    console.log('  ❌ 403 Forbidden — token sem permissão neste endpoint');
  } else {
    console.log(`  ⚠️  ${r.status ?? 'ERRO de rede'}: ${r.error}`);
  }
}

const output = {
  generated_at: new Date().toISOString(),
  note: [
    'flow_ns NÃO é retornado pela API — deve ser copiado manualmente:',
    'Painel ManyChat → Automation → abra o flow → copie o namespace da URL.',
    'Exemplo de URL: https://manychat.com/fb/.../flow/content20250101120000_XXXXX',
    'O valor após "content" é o flow_ns a ser usado na Fase 4.',
  ].join(' '),
  endpoints: results,
};

mkdirSync(join(ROOT, 'discovery', 'output'), { recursive: true });
writeFileSync(
  join(ROOT, 'discovery', 'output', 'manychat.json'),
  JSON.stringify(output, null, 2)
);

console.log('\n✅ discovery/output/manychat.json gravado.\n');
console.log('── RESUMO ───────────────────────────────────────────────────');
for (const r of results) {
  const icon = r.ok ? '✅' : (r.status === 401 ? '🔑' : r.status === 403 ? '🚫' : '❌');
  const count = r.ok && Array.isArray(r.data?.data) ? ` — ${r.data.data.length} itens` : '';
  console.log(`${icon} ${r.label.padEnd(18)} HTTP ${r.status ?? '---'}${count}`);
}
console.log(
  '\nNOTA: flow_ns deve ser copiado manualmente do painel ManyChat → URL do flow.\n'
);
