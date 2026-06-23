# Discovery — Live Dia do Consultor 2026

> **Como usar:** execute os scripts de discovery, depois preencha as tabelas abaixo
> com os IDs encontrados e tome as decisões marcadas como pendentes.
> Este arquivo é commitado; `discovery/output/*.json` não (ver `.gitignore`).

---

## Pipedrive

### Pipelines encontrados

| ID | Nome | Ativo |
|----|------|-------|
|    |      |       |

### Estágios — pipeline alvo

| ID | Nome | Ordem |
|----|------|-------|
|    |      |       |

### Deal fields necessários

| Campo | Presente? | Key / ID no Pipedrive |
|-------|-----------|----------------------|
| campaign_id   | ❓ |  |
| submission_id | ❓ |  |
| utm_source    | ❓ |  |
| utm_medium    | ❓ |  |
| utm_campaign  | ❓ |  |
| utm_content   | ❓ |  |
| utm_term      | ❓ |  |
| fbclid        | ❓ |  |
| gclid         | ❓ |  |
| landing_page  | ❓ |  |
| lead_key_hash | ❓ |  |

### Itens a criar antes da Fase 2

- [ ] Estágio `Inscrito na Live` no pipeline alvo
- [ ] Label `Live Dia do Consultor 2026`
- [ ] Deal fields marcados como ausentes na tabela acima

### Decisões humanas pendentes

| Decisão | Valor escolhido |
|---------|-----------------|
| Pipeline alvo (`PIPEDRIVE_PIPELINE_ID`) | |
| Estágio inicial (`PIPEDRIVE_STAGE_ID`) | |
| Usuário responsável (`PIPEDRIVE_OWNER_ID`) | |

### Env vars sugeridas (Fase 2)

```
PIPEDRIVE_PIPELINE_ID=
PIPEDRIVE_STAGE_ID=
PIPEDRIVE_OWNER_ID=
```

---

## Mailchimp

### Audiências encontradas

| ID | Nome | Contatos |
|----|------|----------|
|    |      |          |

### Merge fields — audiência alvo

| Tag | Presente? | Tipo |
|-----|-----------|------|
| FNAME     | ❓ |  |
| PHONE     | ❓ |  |
| COMPANY   | ❓ |  |
| ZOOMLINK  | ❓ |  |
| LIVE_DATE | ❓ |  |
| LIVE_TIME | ❓ |  |

### Segmentos (tags) relevantes encontrados

| ID | Nome | Contatos |
|----|------|----------|
|    |      |          |

### Itens a criar antes da Fase 3

- [ ] Merge fields marcados como ausentes na tabela acima
- [ ] Segmento/tag `Live Dia do Consultor 2026`

### Decisões humanas pendentes

| Decisão | Valor escolhido |
|---------|-----------------|
| Audiência alvo (`MAILCHIMP_LIST_ID`) | |

### Env vars sugeridas (Fase 3)

```
MAILCHIMP_LIST_ID=
```

---

## ManyChat

### Endpoints — resultado

| Endpoint | Status | Observação |
|----------|--------|------------|
| `/fb/page/getInfo`        | ❓ | |
| `/fb/flow/getList`        | ❓ | |
| `/fb/tag/getList`         | ❓ | |
| `/fb/customField/getList` | ❓ | |
| `/fb/otn/getList`         | ❓ | |

### Flows relevantes (preencher manualmente)

> `flow_ns` não é retornado pela API. Para obtê-lo:
> Painel ManyChat → Automation → abra o flow → copie o namespace da URL.

| Nome do flow | flow_ns |
|--------------|---------|
| Boas-vindas / confirmação da live | |
| Lembrete da live | |

### Decisões humanas pendentes

| Decisão | Valor escolhido |
|---------|-----------------|
| flow_ns boas-vindas (`MANYCHAT_WELCOME_FLOW_NS`) | |
| flow_ns lembrete (`MANYCHAT_REMINDER_FLOW_NS`) | |

### Env vars sugeridas (Fase 4)

```
MANYCHAT_WELCOME_FLOW_NS=
MANYCHAT_REMINDER_FLOW_NS=
```

---

## Env vars consolidadas (todas as fases)

```
# ── Pipedrive ────────────────────────────────────────
PIPEDRIVE_API_TOKEN=
PIPEDRIVE_COMPANY_DOMAIN=
PIPEDRIVE_PIPELINE_ID=
PIPEDRIVE_STAGE_ID=
PIPEDRIVE_OWNER_ID=

# ── Mailchimp ────────────────────────────────────────
MAILCHIMP_API_KEY=
MAILCHIMP_SERVER_PREFIX=
MAILCHIMP_LIST_ID=

# ── ManyChat ─────────────────────────────────────────
MANYCHAT_API_TOKEN=
MANYCHAT_WELCOME_FLOW_NS=
MANYCHAT_REMINDER_FLOW_NS=

# ── Vercel / Serverless (já configurado) ─────────────
ALLOWED_ORIGIN=https://seu-dominio.vercel.app
CAMPAIGN_ID=live-dia-consultor-2026
```
