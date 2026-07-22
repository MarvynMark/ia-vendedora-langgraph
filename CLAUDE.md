# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A LangGraph-based AI sales agent for Instituto Vestigium (Professor Perito Walker's mentorship program), converted from n8n workflows. It handles WhatsApp lead qualification and sales funnel management via Chatwoot webhooks, with audio transcription, TTS responses, and automated follow-ups.

## Commands

```bash
bun run dev          # Dev server with hot reload (--watch)
bun run start        # Production server
bun run setup        # Create PostgreSQL tables (run before first start)
bun run typecheck    # TypeScript type check (bunx tsc --noEmit)
bun run visualize    # Generate PNG diagrams for both graphs
bun test             # Run all tests (sets NODE_ENV=test)
bun test tests/tools/factory.test.ts   # Run a single test file
```

## Architecture

**Runtime**: Bun + ElysiaJS + LangGraph + PostgreSQL

Two LangGraph StateGraphs handle all processing:

### Main Agent Graph (`src/graphs/main-agent/graph.ts`)
Processes incoming Chatwoot webhook messages through a 16-node pipeline:
`enfileirar → esperarDebounce(16s) → verificarStale → tentarLock [→ esperarRetry ↩] → buscarReferenciada → coletarMensagens → executarAgente → verificarNovasMsgs → [formatarSsml→gerarAudio→enviarAudio | formatarTexto→enviarTexto | enviarErroFallback] → liberarLock`

The inner agent (Gusthavo, sales consultant) uses `createReactAgent` with 4 tools (escalation, Kanban tasks, message reactions, reflection).

### Follow-Up Graph (`src/graphs/follow-up/graph.ts`)
Processes scheduled follow-up tasks through a 7-node pipeline:
`buscarFunil → classificar → [agenteFollowup | agenteLembrete | agentePosConsulta] → enviarMensagem → [moverPosVenda]`

Follow-up types are classified by Kanban step:
- **agenteFollowup**: Conexão step — lead qualification follow-up
- **agenteLembrete**: Aguardando Pagamento step — payment reminder
- **agentePosConsulta**: Ganho step — welcome/onboarding message

### Kanban Funnel (fazer.ai)
`Novo Lead → Primeira mensagem → Conexão → Aguardando Pagamento → Ganho | Perdido`

### Key Subsystems
- **Concurrency control**: Message queue (`db/fila.ts`) + conversation lock (`db/lock.ts`) with TTL + debounce prevent race conditions
- **Response pipeline**: Agent output → SSML formatting → ElevenLabs TTS → audio message (falls back to text on audio failure)
- **Checkpointing**: `@langchain/langgraph-checkpoint-postgres` persists agent state across requests
- **Prompts**: System prompts in `prompt.ts`/`prompts.ts`. Only `{{ }}` → `${}` substitutions were made from original n8n workflows.

### HTTP Routes
- `GET /health` — health check
- `POST /webhook/chatwoot` — main agent entry (handles `/reset`, `/teste` commands)
- `POST /webhook/followup` — follow-up graph entry (Kanban webhook)
- `POST /webhook/pagamento` — payment webhook (Digital Manager Guru) — moves card to "Ganho"
- `POST /webhook/cadastrar-lead-formulario-mentoria` — saves mentorship application form leads to DB
- `POST /setup` — database table creation

## Code Conventions

- **Language**: All code, variable names, comments, and log messages are in Brazilian Portuguese
- **Imports**: Use `.ts` extensions in all imports (`import { x } from "./foo.ts"`)
- **Logging**: Use `logger` from `src/lib/logger.ts` (suppressed in test, tagged console in dev, JSON in prod)
- **HTTP calls**: Use `fetchComTimeout` wrapper from `src/lib/fetch-with-timeout.ts` (not raw `fetch`)
- **Tool pattern**: Tools are created via factory in `src/tools/factory.ts`, each tool in its own file using `tool()` from `@langchain/core/tools` with Zod schemas
- **Testing**: Bun's built-in test runner (`bun:test`). Mocking via `mock.module()` and `globalThis.fetch` overrides. Test setup preloaded from `tests/setup.ts` (sets dummy env vars).
- **State**: LangGraph `Annotation.Root` with `MessagesAnnotation` for type-safe graph state
- **TypeScript**: Strict mode, `noUncheckedIndexedAccess`, `noEmit`, `verbatimModuleSyntax`

## Observability (Langfuse) — use this before diagnosing agent behavior

Every graph execution is traced to a self-hosted Langfuse (`https://langfuse.softaxon.tech`),
with `sessionId` = the lead's phone number. Traces contain the exact prompt sent, the raw model
response, every tool call with its arguments, per-node timings, tokens and cost.

**Whenever a question is about what the AI actually did — a bad reply, a tool that didn't fire,
slowness, cost, a prompt change that may have regressed — query Langfuse first instead of
guessing from the source code.** Chatwoot shows what the lead received; Langfuse shows what the
agent reasoned. Use both together: Chatwoot MCP for funnel/Kanban state, Langfuse for the reasoning.

```bash
bun run lf resumo [dias]        # cost, tokens and volume per day
bun run lf sessoes [n]          # most recent leads handled
bun run lf conversa <telefone>  # a lead's full reasoning history (lead → tools → AI)
bun run lf trace <id>           # waterfall: exactly where time and money went
bun run lf lentos [n] [dias]    # slowest traces
bun run lf caros [n] [dias]     # most expensive traces
bun run lf erros [n]            # observations with ERROR/WARNING level
```

Typical loop: `lentos`/`caros` or `conversa <telefone>` to find a suspect trace → `trace <id>`
to see which node is responsible. Source: `src/scripts/langfuse.ts`, handler in `src/lib/langfuse.ts`.

After changing prompts, tools or graph nodes, compare `bun run lf resumo` before/after — a
regression usually shows up as a jump in cost, latency or tool-call count before it shows up in sales.

## External Services

OpenAI (GPT agent + Whisper transcription), Chatwoot (CRM/messaging with fazer.ai Kanban), ElevenLabs (TTS), Digital Manager Guru (payment webhooks). All configured via environment variables (see `.env.example`).
