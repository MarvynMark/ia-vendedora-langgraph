# Agente IA — Clínica Moreira

Agente de IA baseado em LangGraph para a Clínica Moreira (clínica odontológica). Gerencia agendamentos via WhatsApp através de webhooks do Chatwoot, com transcrição de áudio, respostas por TTS e follow-ups automáticos.

Convertido dos workflows originais em n8n para uma arquitetura baseada em grafos com TypeScript.

## Stack

- **Runtime**: [Bun](https://bun.sh)
- **HTTP**: [ElysiaJS](https://elysiajs.com)
- **Orquestração**: [LangGraph](https://langchain-ai.github.io/langgraphjs/) com checkpointing em PostgreSQL
- **LLM**: OpenAI (GPT para agente + Whisper para transcrição)
- **TTS**: ElevenLabs
- **CRM/Mensageria**: Chatwoot (WhatsApp)
- **Calendário**: Google Calendar API
- **Observabilidade**: Langfuse (opcional)
- **Banco de dados**: PostgreSQL 16

## Pré-requisitos

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL 16+ (ou Docker)
- Contas nos serviços externos: OpenAI, Chatwoot, Google Calendar, ElevenLabs

## Início Rápido

```bash
# 1. Clone o repositório
git clone <repo-url>
cd claude-code-com-lucao

# 2. Instale as dependências
bun install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# 4. Suba o PostgreSQL (via Docker)
docker compose up -d

# 5. Crie as tabelas no banco
bun run setup

# 6. Inicie o servidor
bun run dev
```

O servidor estará disponível em `http://localhost:3000`.

## Scripts

| Comando | Descrição |
|---------|-----------|
| `bun run dev` | Servidor com hot reload (`--watch`) |
| `bun run start` | Servidor em modo produção |
| `bun run setup` | Cria as tabelas no PostgreSQL |
| `bun run typecheck` | Verificação de tipos TypeScript |
| `bun test` | Executa todos os testes |
| `bun run visualize` | Gera visualização dos grafos |

## Arquitetura

### Grafo Principal (`src/graphs/main-agent/`)

Processa mensagens recebidas do Chatwoot em um pipeline de 16 nós:

```
enfileirar → esperarDebounce(16s) → verificarStale → tentarLock [→ esperarRetry ↩]
→ buscarReferenciada → coletarMensagens → executarAgente
→ verificarNovasMsgs → [formatarSsml → gerarAudio → enviarAudio
                        | formatarTexto → enviarTexto
                        | enviarErroFallback]
→ liberarLock
```

O agente interno usa `createReactAgent` com 9 ferramentas:

| Ferramenta | Descrição |
|------------|-----------|
| `buscar-agendamentos` | Consulta agendamentos existentes |
| `buscar-janelas` | Busca horários disponíveis no calendário |
| `criar-agendamento` | Cria novo agendamento |
| `atualizar-agendamento` | Atualiza agendamento existente |
| `cancelar-agendamento` | Cancela agendamento |
| `escalar-humano` | Encaminha conversa para atendente humano |
| `reagir-mensagem` | Adiciona reação a mensagem no Chatwoot |
| `atualizar-tarefa` | Gerencia tarefas no Kanban |
| `refletir` | Ferramenta de reflexão do agente |

### Grafo de Follow-Up (`src/graphs/follow-up/`)

Processa tarefas de follow-up agendadas em um pipeline de 7 nós:

```
buscarFunil → classificar → [agenteFollowup | agenteLembrete | agentePosConsulta]
→ enviarMensagem → [moverPosVenda]
```

### Subsistemas

- **Controle de concorrência**: Fila de mensagens (`db/fila.ts`) + lock por conversa (`db/lock.ts`) com TTL + debounce evitam race conditions
- **Pipeline de resposta**: Saída do agente → formatação SSML → TTS via ElevenLabs → mensagem de áudio (fallback para texto em caso de falha)
- **Checkpointing**: `@langchain/langgraph-checkpoint-postgres` persiste o estado do agente entre requisições

## Rotas HTTP

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check |
| `POST` | `/webhook/chatwoot` | Entrada do agente principal (suporta comandos `/reset` e `/teste`) |
| `POST` | `/webhook/followup` | Entrada do grafo de follow-up |
| `POST` | `/setup` | Criação das tabelas no banco |

## Estrutura do Projeto

```
src/
├── config/          # Configuração e variáveis de ambiente
├── db/              # Camada de banco de dados (pool, fila, lock, checkpointer)
├── graphs/          # Grafos LangGraph (main-agent, follow-up)
├── lib/             # Utilitários (logger, fetch, formatação, langfuse)
├── routes/          # Endpoints HTTP
├── services/        # Integrações externas (Chatwoot, Calendar, ElevenLabs, OpenAI)
├── tools/           # Ferramentas do agente (factory + implementações)
├── types/           # Tipos TypeScript
└── index.ts         # Entrada principal do servidor
```

## Variáveis de Ambiente

Consulte o arquivo [`.env.example`](.env.example) para a lista completa. As principais categorias são:

- **Servidor**: `PORT`
- **Banco de dados**: `POSTGRES_*` e `DATABASE_URL`
- **OpenAI**: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MINI_MODEL`
- **Chatwoot**: `CHATWOOT_BASE_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID`
- **Google Calendar**: `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`, `PROFISSIONAL_CALENDAR_IDS`
- **ElevenLabs**: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- **Langfuse** (opcional): `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL`
- **Timing**: `DEBOUNCE_DELAY_MS`, `LOCK_MAX_RETRIES`, `LOCK_RETRY_DELAY_MS`

## Testes

```bash
# Todos os testes
bun test

# Um arquivo específico
bun test tests/tools/factory.test.ts
```

Os testes usam o runner nativo do Bun (`bun:test`) com mocking via `mock.module()` e overrides em `globalThis.fetch`.

## Licença

Projeto privado — uso interno da Clínica Moreira.
