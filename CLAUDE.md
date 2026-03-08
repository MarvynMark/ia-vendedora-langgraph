# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A LangGraph-based AI agent for Clínica Moreira (dental clinic), converted from n8n workflows. It handles WhatsApp appointment scheduling via Chatwoot webhooks, with audio transcription, TTS responses, and automated follow-ups.

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

The inner agent uses `createReactAgent` with 9 tools (scheduling, calendar, escalation, Kanban tasks, message reactions).

### Follow-Up Graph (`src/graphs/follow-up/graph.ts`)
Processes scheduled follow-up tasks through a 7-node pipeline:
`buscarFunil → classificar → [agenteFollowup | agenteLembrete | agentePosConsulta] → enviarMensagem → [moverPosVenda]`

### Key Subsystems
- **Concurrency control**: Message queue (`db/fila.ts`) + conversation lock (`db/lock.ts`) with TTL + debounce prevent race conditions
- **Response pipeline**: Agent output → SSML formatting → ElevenLabs TTS → audio message (falls back to text on audio failure)
- **Checkpointing**: `@langchain/langgraph-checkpoint-postgres` persists agent state across requests
- **Prompts**: Verbatim system prompts from original n8n workflows in `prompt.ts`/`prompts.ts` (~27k chars for main, ~13k for follow-up). Only `{{ }}` → `${}` substitutions were made.

### HTTP Routes
- `GET /health` — health check
- `POST /webhook/chatwoot` — main agent entry (handles `/reset`, `/teste` commands)
- `POST /webhook/followup` — follow-up graph entry
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

## External Services

OpenAI (GPT agent + Whisper transcription), Chatwoot (CRM/messaging), Google Calendar (appointments), ElevenLabs (TTS). All configured via environment variables (see `.env.example`).
