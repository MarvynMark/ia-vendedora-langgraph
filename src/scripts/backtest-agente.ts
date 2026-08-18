/**
 * Backtest do agente de vendas: roda cenários reais contra o agente de verdade
 * (mesmo prompt + gpt-5.2 + temperatura de produção), com as tools MOCKADAS (gravam a
 * chamada, não enviam nada pro Chatwoot/WhatsApp). Pontua as saídas nos bugs conhecidos
 * usando os próprios filtros determinísticos do projeto.
 *
 * Requer OPENAI_API_KEY real no .env (com acesso ao gpt-5.2).
 * Uso: bun run src/scripts/backtest-agente.ts
 */
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { env } from "../config/env.ts";
import { gerarPromptAgentePrincipal } from "../graphs/main-agent/prompt.ts";
import { criarToolsAgenteVestigium } from "../tools/factory.ts";
import {
  blocoEhNomeDeTool,
  blocoNarraAcaoInterna,
  blocoTemFraseProibida,
  blocoNarraEnvioMidia,
  blocoVazaJargaoInterno,
  registrarTextoMidia,
  limparTextosMidia,
} from "../services/chatwoot.ts";
import { dividirEmFrases } from "../lib/response-formatter.ts";
import { montarOutputDoTurno } from "../graphs/main-agent/output.ts";
import { ehRepeticaoDeAlgum } from "../lib/similaridade.ts";

const STEPS = [
  { id: 1, name: "Novo Lead" }, { id: 7, name: "Primeira mensagem" }, { id: 10, name: "Conexao" },
  { id: 8, name: "Aguardando Pagamento" }, { id: 9, name: "Ganho" }, { id: 11, name: "Perdido" }, { id: 12, name: "Nutrir" },
];
const ETAPAS_DESC = STEPS.map(s => `${s.name}: ${s.id}`).join("\n");
const CONV = "backtest";

// Nota anexada em runtime quando a conversa já tem histórico de IA (copiada de graph.ts)
const NOTA_EM_ANDAMENTO = `\n\n⚠️ INSTRUÇÃO CRÍTICA: Esta conversa JÁ está em andamento. Você JÁ se apresentou e provavelmente já avançou no roteiro (reação inicial, áudios, vídeo, imagem). NÃO repita NENHUMA etapa que já fez: não reapresente, não refaça a reação da Mensagem 2, não reofereça nem prometa "reenviar" um áudio/vídeo/imagem que já mandou (cada mídia vai UMA vez só na conversa). Apenas responda ao que o lead acabou de escrever, continuando do ponto atual. Se o lead questionar se é automático/bot ou disser algo como "deixa pra lá", responda com naturalidade e brevidade e NÃO reinicie o roteiro.`;

// Resultado canned por tool (não envia nada; registra mensagem_antes pra os filtros de mídia funcionarem)
function resultadoTool(nome: string, args: Record<string, unknown>): string {
  const antes = typeof args?.["mensagem_antes"] === "string" ? (args["mensagem_antes"] as string) : "";
  if (antes) registrarTextoMidia(CONV, antes);
  if (/Enviar_audio_walker_1/.test(nome)) return "Áudio 1 do Walker enviado com sucesso.";
  if (/Enviar_audio_walker_2/.test(nome)) return "Áudio 2 do Walker enviado com sucesso.";
  if (/Enviar_video/.test(nome)) return "Vídeo enviado com sucesso.";
  if (/Enviar_imagem/.test(nome)) return "Imagem de entregáveis enviada com sucesso.";
  if (/Atualizar_tarefa/.test(nome)) return JSON.stringify({ ok: true });
  if (/Reagir_mensagem/.test(nome)) return "Reação adicionada.";
  if (/Escalar_humano/.test(nome)) return "Escalado para humano.";
  if (/Refletir/.test(nome)) return String(args?.["thought"] ?? "");
  if (/Buscar_contexto/.test(nome)) return "(sem contexto adicional relevante)";
  return "ok";
}

// Tools mockadas: reusa nome/descrição/schema das reais, troca o handler
const chamadasTool: Array<{ nome: string; args: Record<string, unknown> }> = [];
const toolsReais = criarToolsAgenteVestigium({
  idMensagem: "0", idConta: "1", idConversa: CONV, idContato: "0", idInbox: "11",
  telefone: "0", nome: "Lead", mensagem: "", tarefa: { board: { steps: STEPS } },
});
const toolsMock = toolsReais.map((rt: any) =>
  tool(
    async (args: Record<string, unknown>) => {
      chamadasTool.push({ nome: rt.name, args });
      return resultadoTool(rt.name, args);
    },
    { name: rt.name, description: rt.description, schema: rt.schema },
  ),
);

interface Cenario {
  id: string;
  alvo: string; // bug que o cenário mira
  nome: string;
  formulario: string; // formato "Campo: Valor | ..."
  concurso: string;
  turns: string[]; // mensagens do lead, em ordem
  checagens: (ctx: { textos: string[]; chamadas: typeof chamadasTool }) => string[]; // retorna lista de problemas
}

// Helpers de checagem
const juntar = (textos: string[]) => textos.join("\n").toLowerCase();
const contem = (textos: string[], re: RegExp) => textos.some(t => re.test(t));

const CENARIOS: Cenario[] = [
  {
    id: "pitch-sem-grana",
    alvo: "Roteamento: disposto_investir negativo deve receber Trimestral R$997, não Anual/Semestral",
    nome: "Anibal",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Direito | Nível: Iniciante | Maior dificuldade: Constância | Disposto a investir: Infelizmente não no momento! | Pronto para garantir: Sim, com certeza! | Já foi aluno: Ainda não sou aluno",
    turns: [
      "estou começando agora, mas já estudo pra concurso faz um tempo",
      "sim, sinto isso na hora de estudar",
      "quero ver sim",
      "muito boa a plataforma, gostei bastante",
      "e quais são os valores? não precisa mostrar mais nada, só o valor por favor",
      "pode mandar o valor à vista e o parcelado",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      const trimestral = contem(textos, /98,?35|\b997\b|3 meses/i);
      const generico = contem(textos, /3\.?197|1\.?997|\b315\b/i);
      const deuPreco = trimestral || generico;
      if (!deuPreco) { p.push("(inconclusivo — não chegou a dar preço mesmo após insistência)"); return p; }
      if (!trimestral) p.push("NÃO ofereceu o Trimestral (R$997) como oferta de entrada");
      if (generico) p.push("Ofereceu Anual/Semestral pra lead sem grana (deveria ser Trimestral)");
      return p;
    },
  },
  {
    id: "e-um-bot",
    alvo: "Não re-executar o opener nem re-narrar áudio ao ouvir 'é um bot?' / 'deixa pra lá'",
    nome: "Lucas",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Veterinária | Nível: Avançado | Maior dificuldade: material de estudo | Disposto a investir: Infelizmente não no momento! | Pronto para garantir: Sim, com certeza!",
    turns: [
      "pra esse começo agora, mas já sou concursado em outra área",
      "é mensagem automática isso?",
      "pelo visto é. deixa pra lá",
    ],
    checagens: ({ textos, chamadas }) => {
      const p: string[] = [];
      const audiosDepois = chamadas.filter(c => /audio/i.test(c.nome)).length;
      if (audiosDepois > 2) p.push(`Chamou tool de áudio ${audiosDepois}x (re-execução do opener)`);
      if (contem(textos, /gravei um áudio.*(explicando|mostrando)/i) && textos.length > 1) p.push("Re-narrou a apresentação de áudio (possível re-run da Msg 2)");
      if (contem(textos, /vou te (mandar|enviar).*(agora|áudio)/i)) p.push("Narrou envio de áudio (bug de narração)");
      return p;
    },
  },
  {
    id: "medico",
    alvo: "Médico deve receber trilha Médico Legista (R$3.997), não os planos genéricos",
    nome: "Daniel",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Medicina | Nível: Intermediario | Maior dificuldade: Muita matéria | Disposto a investir: Sim, é o que eu quero! | Pronto para garantir: Sim, com certeza!",
    turns: [
      "tô começando agora nessa área de perícia",
      "sim, sinto que falta método",
      "quais são os valores da mentoria?",
      "não precisa do vídeo agora, só me passa os valores por favor",
      "pode mandar o valor à vista e o parcelado",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      const medico = contem(textos, /3\.?997|6\.?497|médico legista|medico legista|\b394\b|\b641\b/i);
      const generico = contem(textos, /98,?35|3\.?197|1\.?997|\b315\b/i);
      const deuPreco = medico || generico;
      if (!deuPreco) { p.push("(inconclusivo — não chegou a dar preço mesmo após insistência)"); return p; }
      if (!medico) p.push("NÃO ofereceu a trilha Médico Legista (R$3.997)");
      if (generico) p.push("Ofereceu plano genérico de Perito Criminal a médico");
      return p;
    },
  },
  {
    // Reproduz a conv 5385: na Mensagem 2 o LLM punha a reação no mensagem_antes do áudio 1 E no
    // content da mesma resposta, e o lead recebia "…formado em Medicina…" duas vezes.
    id: "duplicacao-msg2",
    alvo: "Mensagem 2 não pode repetir a reação (mensagem_antes do áudio 1 vs texto do turno)",
    nome: "Luiz",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Medicina | Nível: Iniciante | Maior dificuldade: Primeira vez estudando | Motivo da mentoria: Direcionamento | Pronto para garantir: Sim, com certeza!",
    turns: [
      "sim",
      "sim, sinto muito isso",
      "deu certo, consegui ver",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      // Quantas vezes a formação foi anunciada ao lead. O roteiro pede exatamente uma.
      const mencoes = textos
        .flatMap(t => dividirEmFrases(t))
        .filter(f => /(vi|acabei de ver|percebi|notei).{0,30}(formad|medicina)/i.test(f));
      if (mencoes.length > 1) {
        p.push(`Anunciou a formação ${mencoes.length}x: ${mencoes.map(m => `"${m.slice(0, 50)}"`).join(" | ")}`);
      }
      return p;
    },
  },
  {
    id: "elegibilidade-area",
    alvo: "Dúvida de elegibilidade de área: enquadramento honesto, não 'sim fazemos' + pivô pra venda",
    nome: "Ana",
    concurso: "PCMG",
    formulario: "Concurso: PCMG | Formação: Biomedicina | Nível: Iniciante | Maior dificuldade: não saber por onde começar | Disposto a investir: Sim, é o que eu quero!",
    turns: [
      "tô começando agora",
      "vocês fazem mentoria pra perito criminal de MG direcionada pra Biomedicina? não sei se tem vaga pra minha área",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      const ultimas = textos.slice(-3);
      if (contem(ultimas, /ningu[ée]m sabe|antes do edital|banca|estar pronto|quando a vaga/i) === false) p.push("NÃO usou o enquadramento honesto de 'vaga para minha área'");
      if (contem(ultimas, /^sim,? (fazemos|atendemos|com certeza)/i)) p.push("Respondeu 'sim fazemos' raso");
      return p;
    },
  },
  {
    id: "despedida",
    alvo: "Sem frases proibidas na despedida; ao 'vou pensar' perguntar o que trava",
    nome: "Carla",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Enfermagem | Nível: Iniciante | Disposto a investir: Sim, é o que eu quero!",
    turns: [
      "tô começando agora",
      "vou pensar e te chamo mês que vem, obrigada",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      if (contem(textos, /boa sorte|à disposição|a disposi[cç][aã]o|fica à vontade/i)) p.push("Usou frase proibida de despedida");
      if (contem(textos, /o que.*(trava|precisa pensar|te segura)|é o valor|é o momento/i) === false) p.push("Não perguntou o que trava no 'vou pensar'");
      return p;
    },
  },
  {
    // Fase 2 / rec #6: no 2º pedido de preço a IA deve DAR o número, não segurar em loop.
    id: "segundo-pedido-preco",
    alvo: "2º pedido de preço deve receber o número na hora, não outro 'já já te passo'",
    nome: "Bruno",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Direito | Nível: Iniciante | Maior dificuldade: foco | Pronto para garantir: Sim, com certeza!",
    turns: [
      "oi, tô começando agora",
      "quanto custa a mentoria?",
      "cara, só me passa o valor por favor, é isso que eu preciso saber pra decidir",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      const ultimas = textos.slice(-4);
      const deuPreco = contem(ultimas, /3\.?197|1\.?997|\b997\b|\b315\b|\b394\b|98,?35|\b197\b/);
      if (!deuPreco) p.push("Segurou o preço mesmo após o lead pedir 2x (não deu o número)");
      return p;
    },
  },
  {
    // Fase 2 / rec #8: após o vídeo, a IA deve avançar aos entregáveis quando o lead reage,
    // sem travar cobrando "conseguiu abrir o vídeo?".
    id: "buraco-video",
    alvo: "Após o vídeo, avançar aos entregáveis na reação do lead, sem travar em 'conseguiu abrir?'",
    nome: "Marina",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Odontologia | Nível: Iniciante | Maior dificuldade: tempo | Pronto para garantir: Sim, com certeza!",
    turns: [
      "sim",
      "sim, sinto isso",
      "pode mandar o vídeo",
      "achei muito bom",
    ],
    checagens: ({ textos, chamadas }) => {
      const p: string[] = [];
      const foiEntregaveis = chamadas.some(c => /imagem_entregaveis/i.test(c.nome)) || contem(textos, /tá incluso|acompanhamento de perto|método gravado|encontros ao vivo/i);
      if (!foiEntregaveis) p.push("Não avançou pros entregáveis após a reação ao vídeo");
      const ultimas = textos.slice(-2);
      if (contem(ultimas, /conseguiu (abrir|ver)|abriu o v[íi]deo|deu certo (o|pra) (abrir|ver)/i)) p.push("Ainda cobrou confirmação de abertura do vídeo (buraco do vídeo)");
      return p;
    },
  },
  {
    // Fase 2 / rec #9: falta de RENDA não pode ser respondida com boilerplate de parcelamento
    // (parcelar não muda que a parcela precisa caber). Deve validar + descer plano OU tratar não-agora.
    id: "renda-sem-parcelamento",
    alvo: "Falta de renda ('não tenho como pagar') não deve ser respondida só com parcelamento",
    nome: "Talita",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Enfermagem | Nível: Iniciante | Maior dificuldade: constância",
    turns: [
      "tô começando agora",
      "quanto custa?",
      "nossa, é bastante. sinceramente não tenho como pagar isso agora, tô desempregada",
    ],
    checagens: ({ textos }) => {
      const p: string[] = [];
      const ultimas = textos.slice(-3);
      const falaParcelamento = contem(ultimas, /parcel|boleto|pix/i);
      const desceOuNaoAgora = contem(ultimas, /semestral|trimestral|mais enxut|3 meses|6 meses|quando (as coisas|o momento|melhorar|puder)|te chamo|posso te chamar|mais pra frente/i);
      if (falaParcelamento && !desceOuNaoAgora) p.push("Respondeu falta de renda só com parcelamento (sem descer plano nem tratar como não-agora)");
      return p;
    },
  },
  {
    // Fase 2 / rec #11: lead inbound quente não deve percorrer as 8 mensagens (áudio/vídeo/imagem)
    // antes do preço — fast-track.
    id: "fast-track",
    alvo: "Lead quente ('quero a mentoria, qual valor?') não deve receber mídia antes do preço",
    nome: "Rafa",
    concurso: "PCDF",
    formulario: "Concurso: PCDF | Formação: Direito | Nível: Avançado | Pronto para garantir: Sim, com certeza!",
    turns: [
      "oi! eu quero muito fazer a mentoria, já acompanho o Walker. qual o valor pra eu começar hoje?",
      "pode mandar o valor à vista e o parcelado",
    ],
    checagens: ({ textos, chamadas }) => {
      const p: string[] = [];
      const deuPreco = contem(textos, /3\.?197|\b315\b|1\.?997|\b197\b|\b997\b/);
      const midiaAntesPreco = chamadas.some(c => /audio|video|imagem/i.test(c.nome));
      if (!deuPreco) p.push("(inconclusivo — não deu preço ao lead quente)");
      else if (midiaAntesPreco) p.push("Enviou mídia (áudio/vídeo/imagem) a um lead quente antes do preço (não fez fast-track)");
      return p;
    },
  },
];

// Detecção genérica de bugs de vazamento em qualquer texto (roda os filtros do projeto)
function bugsDeVazamento(textos: string[]): string[] {
  const p: string[] = [];
  const frases = textos.flatMap(t => dividirEmFrases(t));
  for (const f of frases) {
    if (blocoEhNomeDeTool(f)) p.push(`Nome de tool vazado: "${f.slice(0, 60)}"`);
    if (blocoNarraAcaoInterna(f)) p.push(`Ação interna/nota 3ª pessoa vazada: "${f.slice(0, 60)}"`);
    if (blocoTemFraseProibida(f)) p.push(`Frase proibida: "${f.slice(0, 60)}"`);
    if (blocoVazaJargaoInterno(f)) p.push(`Jargão interno de venda vazado: "${f.slice(0, 60)}"`);
    if (blocoNarraEnvioMidia(CONV, f)) p.push(`Narração de envio de mídia: "${f.slice(0, 60)}"`);
  }
  // Repetição de algo já dito ao lead (duplicação das convs 5385/5525), inclusive parafraseada.
  for (let i = 0; i < frases.length; i++) {
    const anteriores = frases.slice(0, i);
    if (anteriores.length && ehRepeticaoDeAlgum(frases[i]!, anteriores)) {
      p.push(`Repetiu frase já dita ao lead: "${frases[i]!.slice(0, 60)}"`);
    }
  }
  return [...new Set(p)];
}

async function rodarCenario(c: Cenario, llm: ChatOpenAI) {
  limparTextosMidia(CONV);
  chamadasTool.length = 0;
  const tarefa = { board_step: { name: "Primeira mensagem" }, board_step_id: 7, title: c.nome, description: c.formulario, due_date: "", board: { steps: STEPS } };
  const textosIA: string[] = [];
  const messages: any[] = [];
  let temHistoricoAI = false;

  for (const turn of c.turns) {
    limparTextosMidia(CONV);
    let sys = gerarPromptAgentePrincipal({ tarefa, etapasDescricao: ETAPAS_DESC, dataHoraAtual: "terça, 15/07/2026 14:00", dadosFormulario: c.formulario, atributosContato: {}, nomeLead: c.nome });
    if (temHistoricoAI) sys += NOTA_EM_ANDAMENTO;
    const agent = createReactAgent({ llm, tools: toolsMock, prompt: sys });
    messages.push(new HumanMessage(turn));
    const res: any = await agent.invoke({ messages });
    const novas = res.messages.slice(messages.length);
    // Captura o que o lead REALMENTE recebe, na mesma ordem da produção: primeiro o
    // mensagem_antes (enviado pela tool) e depois o output do turno. Usa montarOutputDoTurno para
    // não divergir do grafo — antes o backtest somava o `content` de todas as AIMessages,
    // inclusive o preâmbulo que a produção descarta.
    const { output, mensagensAntes } = montarOutputDoTurno(novas);
    textosIA.push(...mensagensAntes);
    if (output.trim()) textosIA.push(output);
    messages.length = 0; messages.push(...res.messages);
    temHistoricoAI = true;
  }

  const problemas = [...c.checagens({ textos: textosIA, chamadas: chamadasTool }), ...bugsDeVazamento(textosIA)];
  return { textosIA, chamadas: [...chamadasTool], problemas };
}

async function main() {
  const key = env.OPENAI_API_KEY ?? "";
  if (key.length < 40) {
    console.error(`\n❌ OPENAI_API_KEY inválida/placeholder (len=${key.length}). Coloque uma chave real no .env com acesso ao gpt-5.2.\n`);
    process.exit(1);
  }
  const filtro = process.argv[2];
  const cenarios = filtro ? CENARIOS.filter(c => c.id === filtro) : CENARIOS;
  console.log(`\n=== BACKTEST — modelo ${env.OPENAI_MODEL}, temp 0.3, ${cenarios.length} cenário(s) ===\n`);
  const llm = new ChatOpenAI({ modelName: env.OPENAI_MODEL, openAIApiKey: key, temperature: 0.3 });

  let totalProblemas = 0;
  for (const c of cenarios) {
    process.stdout.write(`▶ ${c.id} ... `);
    try {
      const r = await rodarCenario(c, llm);
      const ok = r.problemas.length === 0;
      console.log(ok ? "✅ OK" : `❌ ${r.problemas.length} problema(s)`);
      console.log(`   alvo: ${c.alvo}`);
      console.log(`   tools chamadas: ${r.chamadas.map(x => x.nome).join(", ") || "(nenhuma)"}`);
      for (const p of r.problemas) console.log(`   ⚠️  ${p}`);
      console.log(`   --- mensagens da IA ---`);
      for (const t of r.textosIA) console.log(`   | ${t.replace(/\n/g, " ")}`);
      console.log("");
      if (!ok) totalProblemas += r.problemas.length;
    } catch (e) {
      console.log(`💥 erro: ${String(e).slice(0, 200)}`);
    }
  }
  console.log(`=== RESUMO: ${totalProblemas} problema(s) no total em ${CENARIOS.length} cenários ===\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
