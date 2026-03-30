# Agente IA — Mentoria Vestigium

Agente de IA baseado em LangGraph para o Instituto Vestigium. Gerencia o funil de vendas da mentoria do Professor Perito Walker via WhatsApp através de webhooks do Chatwoot, com transcrição de áudio, respostas por TTS e follow-ups automáticos.

Convertido dos workflows originais em n8n para uma arquitetura baseada em grafos com TypeScript.

## Stack

- **Runtime**: [Bun](https://bun.sh)
- **HTTP**: [ElysiaJS](https://elysiajs.com)
- **Orquestração**: [LangGraph](https://langchain-ai.github.io/langgraphjs/) com checkpointing em PostgreSQL
- **LLM**: OpenAI (GPT para agente + Whisper para transcrição)
- **TTS**: ElevenLabs
- **CRM/Mensageria**: Chatwoot (WhatsApp) com Kanban (fazer.ai)
- **Observabilidade**: Langfuse (opcional)
- **Banco de dados**: PostgreSQL 16

## Pré-requisitos

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL 16+ (ou Docker)
- Contas nos serviços externos: OpenAI, Chatwoot, ElevenLabs

## Início Rápido

```bash
# 1. Clone o repositório
git clone <repo-url>
cd ia-vendedora-langgraph

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

O agente interno (Gusthavo, consultor de vendas) usa `createReactAgent` com 4 ferramentas:

| Ferramenta | Descrição |
|------------|-----------|
| `refletir` | Ferramenta de reflexão do agente |
| `escalar-humano` | Encaminha conversa para atendente humano |
| `atualizar-tarefa` | Gerencia cards no Kanban (move entre etapas do funil) |
| `reagir-mensagem` | Adiciona reação a mensagem no Chatwoot |

### Grafo de Follow-Up (`src/graphs/follow-up/`)

Processa tarefas de follow-up agendadas em um pipeline de 7 nós:

```
buscarFunil → classificar → [agenteFollowup | agenteLembrete | agentePosConsulta]
→ enviarMensagem → [moverPosVenda]
```

Os tipos de follow-up são classificados pela etapa do Kanban:

| Tipo | Etapa | Ação |
|------|-------|------|
| `agenteFollowup` | Conexão | Follow-up de qualificação do lead |
| `agenteLembrete` | Aguardando Pagamento | Lembrete de pagamento |
| `agentePosConsulta` | Ganho | Boas-vindas e onboarding |

### Funil de Vendas (Kanban)

O agente conduz o lead por um funil de 6 etapas:

```
Novo Lead → Primeira mensagem → Conexão → Aguardando Pagamento → Ganho
                                                                ↘ Perdido
```

| Etapa | Quando |
|-------|--------|
| **Novo Lead** | Card criado automaticamente no primeiro contato |
| **Primeira mensagem** | Ao enviar a primeira mensagem de abertura |
| **Conexão** | Lead responde e há engajamento real |
| **Aguardando Pagamento** | Pitch feito e links de pagamento enviados |
| **Ganho** | Lead confirmou o pagamento |
| **Perdido** | Sem resposta após follow-ups ou pediu para não receber mensagens |

### Subsistemas

- **Controle de concorrência**: Fila de mensagens (`db/fila.ts`) + lock por conversa (`db/lock.ts`) com TTL + debounce evitam race conditions
- **Pipeline de resposta**: Saída do agente → formatação SSML → TTS via ElevenLabs → mensagem de áudio (fallback para texto em caso de falha)
- **Checkpointing**: `@langchain/langgraph-checkpoint-postgres` persiste o estado do agente entre requisições

## Rotas HTTP

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check |
| `POST` | `/webhook/chatwoot` | Entrada do agente principal (suporta comandos `/reset` e `/teste`) |
| `POST` | `/webhook/followup` | Entrada do grafo de follow-up (webhook do Kanban) |
| `POST` | `/webhook/pagamento` | Webhook de pagamento (Digital Manager Guru) — move card para "Ganho" |
| `POST` | `/webhook/cadastrar-lead-formulario-mentoria` | Cadastra leads do formulário de aplicação na base |
| `POST` | `/setup` | Criação das tabelas no banco |

## Estrutura do Projeto

```
src/
├── config/          # Configuração, variáveis de ambiente, dados do instituto
├── db/              # Camada de banco de dados (pool, fila, lock, checkpointer)
├── graphs/          # Grafos LangGraph (main-agent, follow-up)
├── lib/             # Utilitários (logger, fetch, formatação, langfuse)
├── routes/          # Endpoints HTTP (webhook, followup, pagamento, aplicação)
├── services/        # Integrações externas (Chatwoot, ElevenLabs, OpenAI)
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

Projeto privado — uso interno do Instituto Vestigium.
