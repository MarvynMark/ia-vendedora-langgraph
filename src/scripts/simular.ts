// Simulador de conversa do agente principal (Walker) — NÃO envia nada real.
// Usa o prompt e as ferramentas REAIS, mas com execução mockada (as tools só
// registram "o que enviariam"). Roda o LLM de verdade (OpenAI) com o prompt atual.
//
// Uso:
//   bun run src/scripts/simular.ts "__START__"          # dispara a abertura da IA
//   bun run src/scripts/simular.ts "mensagem do lead"   # manda uma fala do lead
//   bun run src/scripts/simular.ts "__RESET__"          # zera o histórico
//
// Histórico persiste entre execuções no scratchpad.

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { env } from "../config/env.ts";
import { gerarPromptAgentePrincipal } from "../graphs/main-agent/prompt.ts";
import { criarToolsAgenteVestigium } from "../tools/factory.ts";

const SCRATCH = "/private/tmp/claude-501/-Users-gusthavoabreu-fazer-ai-ia-vendedora-langgraph/4143b2de-268c-4ab4-8a63-78391ae68f29/scratchpad";
const HIST = process.env["SIM_HIST"] ?? `${SCRATCH}/sim-historico.json`;

// --- Cenário do lead (default; sobrescrito por $SIM_CENARIO se for um arquivo JSON) ---
let CENARIO = {
  nomeLead: "Mariana",
  etiquetas: ["agente-on"],
  dadosFormulario:
    "Concurso: PCDF | Formação: Biologia | Maior dificuldade: organização e constância nos estudos | Motivo da mentoria: mudar a vida que levo hoje | Pronto para garantir: Sim, com certeza!",
  tarefa: {
    board: {
      steps: [
        { id: 1, name: "Novo Lead" },
        { id: 7, name: "Primeira mensagem" },
        { id: 10, name: "Conexão" },
        { id: 8, name: "Aguardando Pagamento" },
        { id: 9, name: "Ganho" },
        { id: 11, name: "Perdido" },
        { id: 12, name: "Nutrir" },
      ],
    },
    board_step: { id: 10, name: "Conexão" },
    board_step_id: 10,
    title: "Mariana - PCDF",
    description: "🟢 - Concurso: PCDF\n🔁 - Follow-ups: 0\n👤 - Descrição: inicio",
    due_date: "",
  } as Record<string, unknown>,
};

// Sobrescreve o cenário se $SIM_CENARIO apontar pra um JSON existente
const cenarioPath = process.env["SIM_CENARIO"];
if (cenarioPath && existsSync(cenarioPath)) {
  CENARIO = { ...CENARIO, ...(JSON.parse(readFileSync(cenarioPath, "utf8")) as typeof CENARIO) };
}

const INTRO_SISTEMA =
  "[SISTEMA: O lead pediu o grupo de espera e você já mandou o link. Agora INICIE a conversa de vendas. Se você NUNCA falou com esse lead antes (sem histórico seu na conversa), apresente-se em 1ª pessoa como o Perito Walker, diga que recebeu o formulário e comece pela Mensagem 1 do roteiro. Se JÁ houver histórico seu com ele (lead que está voltando), NÃO se reapresente: dê as boas-vindas de volta de forma natural e retome de onde pararam.]";

type Turn = { type: "human" | "ai"; content: string };

function carregarHistorico(): Turn[] {
  if (!existsSync(HIST)) return [];
  try { return JSON.parse(readFileSync(HIST, "utf8")) as Turn[]; } catch { return []; }
}
function salvarHistorico(h: Turn[]) { writeFileSync(HIST, JSON.stringify(h, null, 2)); }

async function main() {
  const arg = process.argv[2] ?? "";
  if (arg === "__RESET__") {
    if (existsSync(HIST)) rmSync(HIST);
    console.log("🧹 Histórico da simulação zerado.");
    return;
  }
  if (!arg) { console.log("Passe uma mensagem do lead, __START__ ou __RESET__."); return; }

  const historico = carregarHistorico();
  const ehStart = arg === "__START__";
  const userMessage = ehStart ? INTRO_SISTEMA : arg;

  // Monta o system prompt igual ao executarAgente
  const etapas = (CENARIO.tarefa["board"] as { steps: Array<{ id: number; name: string }> }).steps;
  const etapasDescricao = etapas.map((s) => `${s.name}: ${s.id}`).join("\n");
  const dataHoraAtual = new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "long", timeZone: env.TZ });

  let systemPrompt = gerarPromptAgentePrincipal({
    tarefa: CENARIO.tarefa,
    etapasDescricao,
    dataHoraAtual,
    dadosFormulario: CENARIO.dadosFormulario,
    nomeLead: CENARIO.nomeLead,
    etiquetas: CENARIO.etiquetas,
  });

  const temHistoricoAI = historico.some((m) => m.type === "ai");
  if (temHistoricoAI) {
    systemPrompt += `\n\n⚠️ INSTRUÇÃO CRÍTICA: Esta conversa JÁ está em andamento. Você JÁ se apresentou e provavelmente já avançou no roteiro. NÃO repita etapas já feitas nem reofereça mídia já enviada. Apenas responda ao que o lead acabou de escrever, continuando do ponto atual.`;
  }

  // Ferramentas REAIS com execução mockada (não envia nada)
  const chamadas: Array<{ tool: string; args: unknown }> = [];
  const realTools = criarToolsAgenteVestigium({
    idMensagem: "sim", idConta: String(env.CHATWOOT_ACCOUNT_ID), idConversa: "0",
    idContato: "0", idInbox: String(env.CHATWOOT_INBOX_ID), telefone: "+550000000000",
    nome: CENARIO.nomeLead, mensagem: userMessage, tarefa: CENARIO.tarefa,
  });
  const mockTools = realTools.map((t) => new DynamicStructuredTool({
    name: t.name,
    description: t.description ?? "",
    schema: t.schema,
    func: async (input: unknown) => {
      chamadas.push({ tool: t.name, args: input });
      if (t.name === "Buscar_contexto_similar") return "Nenhum contexto relevante encontrado (simulado).";
      if (t.name === "Refletir") return "ok";
      return `[simulado] ${t.name} executada com sucesso.`;
    },
  }));

  const model = new ChatOpenAI({ modelName: env.OPENAI_MODEL, openAIApiKey: env.OPENAI_API_KEY, temperature: 0.3 });
  const agent = createReactAgent({ llm: model, tools: mockTools, prompt: systemPrompt });

  // Reconstrói mensagens (filtra triggers SISTEMA do histórico, como o executarAgente)
  const msgs: BaseMessage[] = [];
  for (const m of historico) {
    if (m.type === "human") {
      if (m.content.startsWith("[SISTEMA:")) continue;
      msgs.push(new HumanMessage(m.content));
    } else {
      msgs.push(new AIMessage(m.content));
    }
  }
  msgs.push(new HumanMessage(userMessage));

  const res = await agent.invoke({ messages: msgs });
  // Igual ao executarAgente: só mensagens NOVAS deste turno (ignora o histórico de input),
  // juntando os textos das AIMessages geradas. Sem isso, respostas antigas reaparecem.
  const novas = (res.messages ?? []).slice(msgs.length);
  const resposta = novas
    .filter((m) => (m as unknown as { _getType: () => string })._getType() === "ai")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter((s) => s.trim().length > 0)
    .join("\n\n") || "(só enviou mídia via ferramenta, sem texto adicional neste turno)";

  // Persiste o turno
  historico.push({ type: "human", content: userMessage });
  historico.push({ type: "ai", content: resposta });
  salvarHistorico(historico);

  // Render
  console.log("\n" + "─".repeat(70));
  if (ehStart) console.log("▶️  (gatilho de início do sistema)");
  else console.log(`🧑 LEAD: ${arg}`);
  console.log("─".repeat(70));
  if (chamadas.length) {
    console.log("⚙️  Ferramentas chamadas pela IA:");
    for (const c of chamadas) console.log(`   • ${c.tool}  ${JSON.stringify(c.args)}`);
    console.log("");
  }
  console.log(`🤖 WALKER:\n${resposta}`);
  console.log("─".repeat(70) + "\n");
}

main().catch((e) => { console.error("Erro na simulação:", e); process.exit(1); });
