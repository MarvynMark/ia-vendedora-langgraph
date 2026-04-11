# Langfuse v3 Self-Hosted — Guia de Configuracao no Coolify

## Arquitetura

O Langfuse v3 roda com **6 containers**:

| Container | Funcao | Porta |
|---|---|---|
| **Langfuse (web)** | API + painel web | 3000 |
| **LangfuseWorker** | Processa filas de ingestao | 3030 |
| **PostgreSQL** | Metadados (users, projects, API keys) | 5432 |
| **ClickHouse** | Armazena traces, observations, scores | 8123/9000 |
| **Redis** | Fila entre API e Worker | 6379 |
| **MinIO** (ou S3) | Blob storage para eventos | 9000/9001 |

## Ponto Critico: Variaveis do Worker

O **LangfuseWorker** precisa ter **TODAS** as mesmas variaveis de ambiente do Langfuse web. No Coolify, o docker-compose usa um YAML anchor `x-app-env`, mas o worker pode nao herda-lo automaticamente.

### Variaveis que DEVEM estar no Worker (alem das basicas):

**ClickHouse:**
```
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_MIGRATION_URL=clickhouse://clickhouse:9000
CLICKHOUSE_USER=${SERVICE_USER_CLICKHOUSE}
CLICKHOUSE_PASSWORD=${SERVICE_PASSWORD_CLICKHOUSE}
CLICKHOUSE_CLUSTER_ENABLED=false
```

**S3/MinIO (todas as 22+ variaveis):**
```
LANGFUSE_S3_EVENT_UPLOAD_ENABLED=true
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_REGION=auto
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=<minio-user>
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=<minio-password>
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://minio:9000
LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true
LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/

LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_MEDIA_UPLOAD_REGION=auto
LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=<minio-user>
LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=<minio-password>
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://minio:9000
LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=true
LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=media/

LANGFUSE_S3_BATCH_EXPORT_ENABLED=false
LANGFUSE_S3_BATCH_EXPORT_BUCKET=langfuse
LANGFUSE_S3_BATCH_EXPORT_PREFIX=exports/
LANGFUSE_S3_BATCH_EXPORT_REGION=auto
LANGFUSE_S3_BATCH_EXPORT_ENDPOINT=
LANGFUSE_S3_BATCH_EXPORT_EXTERNAL_ENDPOINT=
LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID=
LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=
LANGFUSE_S3_BATCH_EXPORT_FORCE_PATH_STYLE=true

LANGFUSE_USE_AZURE_BLOB=false
```

**Sem MinIO** (alternativa simples para baixo volume):
```
LANGFUSE_S3_EVENT_UPLOAD_ENABLED=false
```
> Processa eventos direto no banco. Suficiente para volume baixo/medio.

## Checklist Pos-Deploy

### 1. Verificar saude da API
No terminal do container da aplicacao que usa Langfuse:
```bash
bun -e "fetch('https://<langfuse-url>/api/public/health').then(r=>r.text().then(t=>console.log(r.status,t)))"
```
Esperado: `200 {"status":"OK","version":"..."}`

### 2. Verificar autenticacao (endpoint de ingestao)
```bash
echo 'fetch("https://<langfuse-url>/api/public/ingestion",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Basic "+btoa("<public-key>:<secret-key>")},body:JSON.stringify({batch:[]})}).then(function(r){return r.text().then(function(t){console.log(r.status,t)})}).catch(function(e){console.log("ERRO:",e.message)})' > /tmp/t.js && bun /tmp/t.js
```
Esperado: `207 {"successes":[],"errors":[]}`

### 3. Enviar trace de teste
```bash
bun -e "var b=JSON.stringify({batch:[{id:'test-'+Date.now(),type:'trace-create',timestamp:new Date().toISOString(),body:{name:'teste-setup',sessionId:'debug'}}]});fetch('https://<langfuse-url>/api/public/ingestion',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Basic '+btoa('<public-key>:<secret-key>')},body:b}).then(function(r){return r.text().then(function(t){console.log(r.status,t)})}).catch(function(e){console.log('ERRO:',e.message)})"
```
Esperado: `207 {"successes":[{"id":"test-...","status":201}],"errors":[]}`

### 4. Verificar se o trace aparece no painel
- Acesse Langfuse -> Home -> Traces
- O trace "teste-setup" deve aparecer em ate 30 segundos

### 5. Verificar logs do Worker
O LangfuseWorker deve mostrar processamento de `ingestion-queue`. Se so mostrar "executor started" sem nunca processar, as variaveis estao faltando.

## Troubleshooting

| Sintoma | Causa provavel | Solucao |
|---|---|---|
| API retorna 207 mas nenhum trace aparece | Worker sem variaveis S3/ClickHouse | Sincronizar env vars do web -> worker |
| `Failed to upload to S3` nos logs | MinIO nao configurado ou credenciais erradas | Configurar MinIO ou usar `S3_EVENT_UPLOAD_ENABLED=false` |
| `Could not load credentials from any providers` | Variaveis S3 vazias (sem endpoint/keys) | Preencher com credenciais do MinIO |
| `SyntaxError: Failed to parse JSON` no SDK | Langfuse retornando HTML em vez de JSON (proxy/S3 error) | Verificar logs do Langfuse web por erros de S3 |
| `JWT_SESSION_ERROR decryption failed` | NEXTAUTH_SECRET mudou apos restart | Limpar cookies do navegador e refazer login |
| `401 Invalid authorization header` | API keys invalidas ou revogadas | Verificar Settings -> API Keys no painel |
| Worker so mostra "executor started" | Worker desconectado do Redis ou sem env vars | Comparar env vars entre web e worker |

## Configuracao no SDK (aplicacao)

Variaveis de ambiente necessarias na aplicacao que envia traces:
```
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASEURL=https://<langfuse-url>
```

> **Nota**: O prefixo da public key e `pk-lf-`, nao `k-lf-`.

## Instancia Atual

- URL: https://langfuse.softaxon.tech
- Hospedado no Coolify em 188.245.146.142
- Image: `langfuse/langfuse:3` (v3.163.0)
- MinIO configurado como blob storage
