// Fluxo do corretor no WhatsApp do Suporte 1 (inbox CORRETOR_INBOX_ID).
//
//   /corrigir [concurso] [G05]
//     → concurso (se houver mais de um)  → área (só na 1ª vez; fica salva)
//     → enunciado (texto, foto ou código do banco)  → resposta (fotos/PDF/texto, várias mensagens)
//     → PRONTO → transcrição numerada → aluno confere (pode pedir ajuste) → CORRIGIR
//     → devolutiva com UM foco + desafio
//     → DETALHES / ERROS / MODELO sob demanda · REESCREVER → o aluno reescreve e recebe retorno
//
// Fora do modo correção, as mensagens do Suporte 1 seguem para a equipe como sempre: o fluxo só
// age com sessão aberta ou com um comando que começa com "/". As etapas lentas (ler foto, corrigir)
// rodam em background e são rastreadas para o desligamento gracioso não matá-las no meio.
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { rastrear } from "../lib/processamentos-ativos.ts";
import { adicionarEtiquetas, enviarMensagem } from "../services/chatwoot.ts";
import type { ChatwootWebhookPayload } from "../types/chatwoot.ts";
import { avaliarResposta } from "./avaliacao.ts";
import { mensagemDetalhes, mensagemErros, mensagemModelo, mensagemPrincipal, mensagemReescrita } from "./devolutiva.ts";
import { obterEspelhoExigido } from "./espelho.ts";
import { historicoParaIA } from "./historico.ts";
import { ajustarTranscricao, transcreverEnunciado, transcreverResposta } from "./leitura.ts";
import { type Anexo, ErroAnexo } from "./openai.ts";
import { avaliarReescrita } from "./reescrita.ts";
import { PERFIS, buscarPerfil } from "./perfis/index.ts";
import {
  type CalculoNota,
  buscarQuestao,
  formatarNumero,
  codigoQuestaoNoTexto,
  dividirMensagem,
  interpretarArea,
  interpretarComando,
  interpretarConcurso,
  linhasConsideradas,
  contarPalavras,
  linhasDeTextoDigitado,
  numerarLinhas,
  palavrasMinimas,
  type Comando,
} from "./regras.ts";
import {
  adicionarParte,
  apagarSessao,
  areaDoAluno,
  atualizarSessao,
  buscarCorrecao,
  buscarSessao,
  correcoesHoje,
  iniciarSessao,
  registrarCorrecao,
  registrarReescrita,
  salvarAreaDoAluno,
  ultimasCorrecoes,
  type Sessao,
} from "./sessao.ts";
import type { AvaliacaoIA, PerfilConcurso } from "./tipos.ts";

export const ETIQUETA_TESTE = "teste-corretor";
export const ETIQUETA_CORRETOR = "corretor-redacao";

// Tempo para os webhooks das últimas fotos chegarem antes de ler as partes ("PRONTO" pode chegar
// antes da foto que foi enviada um instante antes dele).
const ESPERA_ULTIMAS_PARTES_MS = 4000;

interface Contexto {
  conta: string;
  conversaId: string;
  telefone: string;
  enviar: (texto: string) => Promise<void>;
}

/** O corretor deve olhar esta conversa? (modo off/teste/on) */
export function corretorAtende(inboxId: number, labels: string[]): boolean {
  if (inboxId !== env.CORRETOR_INBOX_ID) return false;
  if (env.CORRETOR_MODO === "off") return false;
  if (env.CORRETOR_MODO === "teste") return labels.includes(ETIQUETA_TESTE);
  return true;
}

/**
 * Trata a mensagem do aluno se ela for do corretor. Retorna a ação tomada, ou null quando a
 * mensagem não é do corretor e deve seguir o caminho normal.
 */
export async function tratarMensagemCorretor(payload: ChatwootWebhookPayload): Promise<string | null> {
  const conversaId = String(payload.conversation.id);
  const conta = String(payload.account.id);
  const texto = (payload.content ?? "").trim();
  const anexos: Anexo[] = (payload.attachments ?? []).map((a) => ({ tipo: a.file_type, url: a.data_url }));
  const comando = texto ? interpretarComando(texto) : null;
  const ctx: Contexto = {
    conta,
    conversaId,
    telefone: payload.sender.phone_number ?? payload.conversation.contact_inbox?.source_id ?? "",
    enviar: async (t) => {
      for (const parte of dividirMensagem(t)) await enviarMensagem(conta, conversaId, parte);
    },
  };

  const sessao = await buscarSessao(conversaId);

  // "/corrigir" sem argumentos na conferência da transcrição é o aluno confirmando, não recomeçando.
  if (comando?.tipo === "iniciar" && !(sessao?.etapa === "confirmar" && !comando.concurso && !comando.codigo)) {
    await iniciar(ctx, comando);
    return "corretor:iniciar";
  }

  if (!sessao) {
    // PRONTO e CORRIGIR soltos também, mas só em conversa que já usou o corretor: o aluno que
    // voltou depois de a sessão fechar ficava sem resposta (conv 10066), e num "pronto" dito à
    // equipe o corretor não deve se meter.
    const jaUsou = payload.conversation.labels.includes(ETIQUETA_CORRETOR);
    if (comando && (texto.startsWith("/") || jaUsou)) {
      await ctx.enviar("Seu modo correção não está aberto (ele fecha depois de 4 horas parado). Para corrigir uma resposta, digite */corrigir* e siga os passos de novo.");
      return "corretor:sem_sessao";
    }
    return null;
  }

  if (comando?.tipo === "cancelar") {
    await apagarSessao(conversaId);
    await ctx.enviar("Correção cancelada. Quando quiser, é só digitar */corrigir*.");
    return "corretor:cancelar";
  }

  switch (sessao.etapa) {
    case "concurso": return etapaConcurso(ctx, sessao, texto);
    case "area": return etapaArea(ctx, sessao, texto);
    case "enunciado": return etapaEnunciado(ctx, sessao, texto, anexos);
    case "resposta": return etapaResposta(ctx, sessao, texto, anexos, comando);
    case "confirmar": return etapaConfirmar(ctx, sessao, texto, anexos, comando);
    case "corrigindo": return etapaCorrigindo(ctx);
    case "pos_correcao": return etapaPosCorrecao(ctx, sessao, comando);
    case "reescrita": return etapaReescrita(ctx, sessao, texto, anexos, comando);
  }
}

// ── Início ──────────────────────────────────────────────────────────────────────────────────────

async function iniciar(ctx: Contexto, comando: Extract<Comando, { tipo: "iniciar" }>): Promise<void> {
  const feitas = await correcoesHoje(ctx.telefone);
  if (feitas >= env.CORRETOR_LIMITE_DIARIO) {
    await ctx.enviar(`Você já fez ${feitas} correções hoje, que é o limite diário. Amanhã libera de novo 🙂`);
    return;
  }
  adicionarEtiquetas(ctx.conta, ctx.conversaId, [ETIQUETA_CORRETOR])
    .catch((e) => logger.warn("corretor", "Falha ao etiquetar conversa", e));

  const perfil = comando.concurso
    ? buscarPerfil(comando.concurso) ?? interpretarConcurso(comando.concurso, PERFIS)
    : PERFIS.length === 1 ? PERFIS[0]! : null;

  if (!perfil) {
    await iniciarSessao({ conversaId: ctx.conversaId, telefone: ctx.telefone, etapa: "concurso", concurso: null, area: null, codigoQuestao: comando.codigo, enunciado: null });
    await ctx.enviar(`📝 *Corretor de discursivas — Mentoria Vestigium*\n\nPara qual concurso é a sua resposta?\n${listaConcursos()}`);
    return;
  }
  await seguirComPerfil(ctx, perfil, comando.codigo, true);
}

function listaConcursos(): string {
  return PERFIS.map((p, i) => `${i + 1}. ${p.nome} (/corrigir ${p.codigo})`).join("\n");
}

function listaAreas(perfil: PerfilConcurso): string {
  return Object.entries(perfil.areas).map(([cod, nome], i) => `${i + 1}. ${nome} (${cod})`).join("\n");
}

async function seguirComPerfil(ctx: Contexto, perfil: PerfilConcurso, codigo: string | null, abertura: boolean): Promise<void> {
  const cabecalho = abertura ? `📝 *Corretor de discursivas — ${perfil.nome}*\n\n` : "";
  const area = await areaDoAluno(ctx.telefone, perfil.codigo);
  if (!area) {
    await iniciarSessao({ conversaId: ctx.conversaId, telefone: ctx.telefone, etapa: "area", concurso: perfil.codigo, area: null, codigoQuestao: codigo, enunciado: null });
    await ctx.enviar(`${cabecalho}Qual é a sua área de formação para o concurso de ${perfil.nome}? Responda com o número:\n${listaAreas(perfil)}`);
    return;
  }
  await irParaEnunciado(ctx, perfil, area, codigo, cabecalho);
}

async function irParaEnunciado(ctx: Contexto, perfil: PerfilConcurso, area: string, codigo: string | null, prefixo = ""): Promise<void> {
  if (codigo) {
    const q = buscarQuestao(perfil, codigo, area);
    if (q) {
      await iniciarSessao({ conversaId: ctx.conversaId, telefone: ctx.telefone, etapa: "resposta", concurso: perfil.codigo, area, codigoQuestao: codigo, enunciado: q.enunciado });
      await ctx.enviar(`${prefixo}${mensagemEnunciado(q.enunciado, codigo)}`);
      return;
    }
    prefixo += `Não encontrei a questão ${codigo} no banco${codigo.startsWith("E") ? ` da sua área (${perfil.areas[area]})` : ""}.\n\n`;
  }
  await iniciarSessao({ conversaId: ctx.conversaId, telefone: ctx.telefone, etapa: "enunciado", concurso: perfil.codigo, area, codigoQuestao: null, enunciado: null });
  await ctx.enviar(`${prefixo}Me mande o *enunciado* da questão que você respondeu (texto ou foto).\n\nSe for uma questão do nosso banco, mande só o código: por exemplo *G05* (conhecimentos gerais) ou *E03* (da sua área: ${perfil.areas[area]}).\n\nPara sair a qualquer momento: /cancelar`);
}

function mensagemEnunciado(enunciado: string, codigo: string | null): string {
  const exibido = enunciado.length > 1500 ? `${enunciado.slice(0, 1500)}…` : enunciado;
  return `📌 *Enunciado${codigo ? ` ${codigo}` : ""}:*\n${exibido}\n\nAgora envie a sua *resposta*: foto(s) da folha, PDF ou o texto digitado. Pode mandar em mais de uma mensagem.\n\nQuando terminar, digite *PRONTO*.`;
}

// ── Etapas ──────────────────────────────────────────────────────────────────────────────────────

async function etapaConcurso(ctx: Contexto, sessao: Sessao, texto: string): Promise<string> {
  const perfil = texto ? interpretarConcurso(texto, PERFIS) : null;
  if (!perfil) {
    await ctx.enviar(`Não entendi o concurso. Responda com o número:\n${listaConcursos()}`);
    return "corretor:concurso_invalido";
  }
  await seguirComPerfil(ctx, perfil, sessao.codigoQuestao, false);
  return "corretor:concurso";
}

async function etapaArea(ctx: Contexto, sessao: Sessao, texto: string): Promise<string> {
  const perfil = buscarPerfil(sessao.concurso)!;
  const area = texto ? interpretarArea(texto, perfil) : null;
  if (!area) {
    await ctx.enviar(`Não entendi a área. Responda só com o número:\n${listaAreas(perfil)}`);
    return "corretor:area_invalida";
  }
  await salvarAreaDoAluno(ctx.telefone, perfil.codigo, area);
  await irParaEnunciado(ctx, perfil, area, sessao.codigoQuestao, `Área: *${perfil.areas[area]}* ✅\n\n`);
  return "corretor:area";
}

async function etapaEnunciado(ctx: Contexto, sessao: Sessao, texto: string, anexos: Anexo[]): Promise<string> {
  const perfil = buscarPerfil(sessao.concurso)!;
  if (anexos.length) {
    emBackground(ctx, "ler enunciado", async () => {
      const enunciado = await transcreverEnunciado(anexos);
      if (!enunciado) {
        await ctx.enviar("Não consegui ler o enunciado nessa imagem. Pode mandar em texto ou uma foto mais nítida?");
        return;
      }
      await atualizarSessao(ctx.conversaId, { etapa: "resposta", enunciado }, "enunciado");
      await ctx.enviar(mensagemEnunciado(enunciado, null));
    });
    return "corretor:enunciado_anexo";
  }

  const codigo = codigoQuestaoNoTexto(texto);
  if (codigo) {
    await irParaEnunciado(ctx, perfil, sessao.area!, codigo);
    return "corretor:enunciado_banco";
  }
  if (texto.length < 20) {
    await ctx.enviar("Me mande o enunciado completo da questão (o comando, com os subitens), ou o código dela no banco, como *G05*.");
    return "corretor:enunciado_curto";
  }
  await atualizarSessao(ctx.conversaId, { etapa: "resposta", enunciado: texto }, "enunciado");
  await ctx.enviar(mensagemEnunciado(texto, null));
  return "corretor:enunciado";
}

async function etapaResposta(ctx: Contexto, sessao: Sessao, texto: string, anexos: Anexo[], comando: Comando | null): Promise<string> {
  if (comando?.tipo === "pronto") {
    if (!(await atualizarSessao(ctx.conversaId, { etapa: "corrigindo" }, "resposta"))) return "corretor:pronto_duplicado";
    emBackground(ctx, "fechar resposta", () => fecharResposta(ctx), "resposta");
    return "corretor:pronto";
  }

  const naoSuportados = anexos.filter((a) => a.tipo !== "image" && a.tipo !== "file");
  if (naoSuportados.length) {
    await ctx.enviar("Consigo ler foto, PDF ou texto digitado. Áudio e vídeo eu não consigo corrigir 🙂");
    return "corretor:anexo_nao_suportado";
  }

  let total = 0;
  if (anexos.length) {
    for (const anexo of anexos) total = await adicionarParte(ctx.conversaId, { anexo });
  } else if (texto) {
    total = await adicionarParte(ctx.conversaId, { texto });
  } else {
    return "corretor:vazio";
  }

  await ctx.enviar(total === 1
    ? "Recebi ✅ Se tiver mais páginas ou partes, mande agora. Quando terminar, digite *PRONTO*."
    : `Recebi a parte ${total} ✅`);
  return "corretor:parte";
}

async function etapaConfirmar(ctx: Contexto, sessao: Sessao, texto: string, anexos: Anexo[], comando: Comando | null): Promise<string> {
  if (comando?.tipo === "corrigir" || comando?.tipo === "iniciar") {
    if (!(await atualizarSessao(ctx.conversaId, { etapa: "corrigindo" }, "confirmar"))) return "corretor:corrigir_duplicado";
    emBackground(ctx, "corrigir", () => executarCorrecao(ctx), "confirmar");
    return "corretor:corrigir";
  }
  if (anexos.length || comando?.tipo === "pronto") {
    await ctx.enviar("Se a transcrição estiver certa, digite *CORRIGIR*. Para trocar a resposta inteira, digite */corrigir* e comece de novo.");
    return "corretor:confirmar_dica";
  }

  emBackground(ctx, "ajustar transcrição", async () => {
    const { linhas, entendeu } = await ajustarTranscricao(sessao.transcricao ?? [], texto);
    if (!entendeu) {
      await ctx.enviar("Não entendi o ajuste. Me diga a linha e a palavra certa (ex.: _linha 5: perícia_), ou digite *CORRIGIR* se estiver tudo certo.");
      return;
    }
    await atualizarSessao(ctx.conversaId, { transcricao: linhas }, "confirmar");
    await ctx.enviar(mensagemTranscricao(linhas, "", true));
  });
  return "corretor:ajuste";
}

// ── Etapas lentas (background) ──────────────────────────────────────────────────────────────────

function mensagemTranscricao(linhas: string[], aviso: string, ajustada = false): string {
  return [
    `📄 *${ajustada ? "Transcrição ajustada" : "Transcrição da sua resposta"}* (${linhas.length} linhas)`,
    numerarLinhas(linhas),
    aviso ? `⚠️ ${aviso}` : "",
    "Confira se transcrevi corretamente. Alguma palavra ficou errada ou ilegível? Me diga a linha e a palavra certa.\n\nSe estiver tudo certo, digite *CORRIGIR* que eu faço a avaliação completa.",
  ].filter(Boolean).join("\n\n");
}

/** PRONTO: lê as partes. Manuscrito → transcrição para conferir; digitado → corrige direto. */
async function fecharResposta(ctx: Contexto): Promise<void> {
  await new Promise((r) => setTimeout(r, ESPERA_ULTIMAS_PARTES_MS));
  const sessao = await buscarSessao(ctx.conversaId);
  if (!sessao) return;
  const perfil = buscarPerfil(sessao.concurso)!;
  const anexos = sessao.partes.flatMap((p) => (p.anexo ? [p.anexo] : []));
  const textos = sessao.partes.flatMap((p) => (p.texto ? [p.texto] : []));

  if (!anexos.length && !textos.length) {
    await atualizarSessao(ctx.conversaId, { etapa: "resposta" });
    await ctx.enviar("Ainda não recebi a sua resposta. Mande as fotos, o PDF ou o texto e depois digite *PRONTO*.");
    return;
  }

  if (anexos.length) {
    await ctx.enviar("Lendo a sua resposta… ⏳");
    const { linhas, aviso } = await transcreverResposta(anexos);
    if (!linhas.length) {
      await atualizarSessao(ctx.conversaId, { etapa: "resposta" });
      await ctx.enviar(`Não consegui ler texto nesse arquivo${aviso ? ` (${aviso})` : ""}. Mande uma foto mais nítida, um PDF ou o texto digitado, e depois *PRONTO*.`);
      return;
    }
    if (await respostaCurtaDemais(ctx, perfil, linhas.join(" "))) return;
    await atualizarSessao(ctx.conversaId, { etapa: "confirmar", transcricao: linhas, digitada: false, linhasEstimadas: false });
    await ctx.enviar(mensagemTranscricao(linhas, aviso));
    return;
  }

  if (await respostaCurtaDemais(ctx, perfil, textos.join(" "))) return;
  const { linhas, estimadas } = linhasDeTextoDigitado(textos.join("\n"), perfil);
  await atualizarSessao(ctx.conversaId, { transcricao: linhas, digitada: true, linhasEstimadas: estimadas });
  await executarCorrecao(ctx);
}

/**
 * Triagem antes da IA: texto curto demais não é corrigido nem conta no limite do dia. A sessão
 * volta para "resposta" com as partes já recebidas — o aluno pode completar e mandar PRONTO.
 */
async function respostaCurtaDemais(ctx: Contexto, perfil: PerfilConcurso, texto: string): Promise<boolean> {
  const palavras = contarPalavras(texto);
  if (palavras >= palavrasMinimas(perfil)) return false;
  await atualizarSessao(ctx.conversaId, { etapa: "resposta" });
  await ctx.enviar(`Recebi só ${palavras} palavra(s) — isso ainda não dá para corrigir. Uma resposta de ${perfil.linhasMin} a ${perfil.linhasMax} linhas tem por volta de ${perfil.linhasMin * 11} a ${perfil.linhasMax * 11} palavras.\n\nMande a sua resposta completa (texto, foto ou PDF) e digite *PRONTO*. Esta tentativa não contou no seu limite do dia.`);
  return true;
}

async function executarCorrecao(ctx: Contexto): Promise<void> {
  const sessao = await buscarSessao(ctx.conversaId);
  if (!sessao?.transcricao || !sessao.enunciado) return;
  const perfil = buscarPerfil(sessao.concurso)!;

  await ctx.enviar("Corrigindo… ⏳ Leva cerca de 1 minuto.");

  const anteriores = await ultimasCorrecoes(ctx.telefone, perfil.codigo).catch(() => []);
  const { consideradas, descartadas } = linhasConsideradas(sessao.transcricao, perfil, sessao.linhasEstimadas);
  const exigidos = await obterEspelhoExigido(perfil, sessao.enunciado);
  const { avaliacao, calculo } = await avaliarResposta({
    perfil,
    area: sessao.area,
    enunciado: sessao.enunciado,
    exigidos,
    linhas: consideradas,
    linhasDescartadas: descartadas,
    digitada: sessao.digitada,
    linhasEstimadas: sessao.linhasEstimadas,
    historico: historicoParaIA(anteriores),
    telefone: ctx.telefone,
  }, sessao.transcricao);

  const correcaoId = await registrarCorrecao({
    telefone: ctx.telefone,
    conversaId: ctx.conversaId,
    concurso: perfil.codigo,
    area: sessao.area,
    codigoQuestao: sessao.codigoQuestao,
    enunciado: sessao.enunciado,
    transcricao: sessao.transcricao,
    avaliacao,
    calculo,
    nota: calculo.nq,
    autoavaliacao: null,
  });
  await atualizarSessao(ctx.conversaId, { etapa: "pos_correcao", correcaoId });

  const meta = { linhasEstimadas: sessao.linhasEstimadas, codigoQuestao: sessao.codigoQuestao, anteriores };
  for (const msg of mensagemPrincipal(perfil, avaliacao, calculo, meta)) await enviarMensagem(ctx.conta, ctx.conversaId, msg);
  logger.info("corretor", "Correção entregue", { conversa: ctx.conversaId, concurso: perfil.codigo, nota: calculo.nq, correcaoId });
}

// ── Depois da correção ──────────────────────────────────────────────────────────────────────────

async function etapaCorrigindo(ctx: Contexto): Promise<string> {
  await ctx.enviar("Sua correção está saindo ⏳ Leva cerca de 1 minuto.");
  return "corretor:aguarde";
}

interface CorrecaoCarregada {
  perfil: PerfilConcurso;
  avaliacao: AvaliacaoIA;
  calculo: CalculoNota;
  linhasEstimadas: boolean;
  enunciado: string;
  transcricao: string[];
  id: number;
  telefone: string;
}

async function carregarCorrecao(sessao: Sessao): Promise<CorrecaoCarregada | null> {
  if (!sessao.correcaoId) return null;
  const c = await buscarCorrecao(sessao.correcaoId);
  const perfil = buscarPerfil(c?.concurso);
  if (!c || !perfil || !c.calculo) return null;
  return {
    perfil,
    avaliacao: c.avaliacao as AvaliacaoIA,
    calculo: c.calculo as CalculoNota,
    linhasEstimadas: sessao.linhasEstimadas,
    enunciado: c.enunciado,
    transcricao: c.transcricao,
    id: c.id,
    telefone: sessao.telefone,
  };
}

/**
 * Devolutiva entregue: o detalhe vem sob demanda e o desafio fica à espera. Qualquer outra
 * mensagem segue para a equipe (null) — o aluno pode estar falando com o suporte.
 */
async function etapaPosCorrecao(ctx: Contexto, sessao: Sessao, comando: Comando | null): Promise<string | null> {
  if (!comando || !["detalhes", "erros", "modelo", "reescrever"].includes(comando.tipo)) return null;
  const c = await carregarCorrecao(sessao);
  if (!c) {
    await ctx.enviar("Não encontrei a sua última correção. Digite */corrigir* para corrigir uma nova resposta.");
    return "corretor:sem_correcao";
  }
  switch (comando.tipo) {
    case "detalhes":
      for (const m of mensagemDetalhes(c.perfil, c.avaliacao, c.calculo, c)) await ctx.enviar(m);
      return "corretor:detalhes";
    case "erros": {
      const anteriores = (await ultimasCorrecoes(c.telefone, c.perfil.codigo, 6).catch(() => [])).filter((x) => x.id !== c.id);
      for (const m of mensagemErros(c.perfil, c.avaliacao, { linhasEstimadas: c.linhasEstimadas, anteriores })) await ctx.enviar(m);
      return "corretor:erros";
    }
    case "modelo":
      for (const m of mensagemModelo(c.perfil, c.avaliacao)) await ctx.enviar(m);
      return "corretor:modelo";
    default:
      await atualizarSessao(ctx.conversaId, { etapa: "reescrita" });
      await ctx.enviar(`🏋️ *Desafio*
${c.avaliacao.desafio?.instrucao ?? "Reescreva o trecho do seu ponto de virada."}

Mande sua versão agora (texto ou foto). Para desistir, digite */cancelar*.`);
      return "corretor:reescrever";
  }
}

async function etapaReescrita(ctx: Contexto, sessao: Sessao, texto: string, anexos: Anexo[], comando: Comando | null): Promise<string> {
  // Pedir DETALHES/ERROS/MODELO no meio do desafio continua funcionando.
  if (comando && comando.tipo !== "reescrever") {
    await atualizarSessao(ctx.conversaId, { etapa: "pos_correcao" });
    return (await etapaPosCorrecao(ctx, { ...sessao, etapa: "pos_correcao" }, comando)) ?? "corretor:reescrita_ignorada";
  }
  if (!anexos.length && texto.length < 15) {
    await ctx.enviar("Mande a sua versão do trecho (texto ou foto).");
    return "corretor:reescrita_curta";
  }
  emBackground(ctx, "conferir reescrita", async () => {
    const c = await carregarCorrecao(sessao);
    if (!c) return;
    const tentativa = anexos.length ? (await transcreverResposta(anexos)).linhas.join(" ") : texto;
    const retorno = await avaliarReescrita({
      enunciado: c.enunciado,
      pontoDeVirada: `${c.avaliacao.pontoDeVirada.problema} ${c.avaliacao.pontoDeVirada.comoFazer}`,
      desafio: c.avaliacao.desafio.instrucao,
      criterioSucesso: c.avaliacao.desafio.criterioSucesso,
      trechoOriginal: c.avaliacao.antesDepois.antes,
      tentativa,
    });
    await registrarReescrita(c.id, tentativa, retorno.atingiu, retorno).catch((e) => logger.warn("corretor", "Falha ao registrar reescrita", e));
    await atualizarSessao(ctx.conversaId, { etapa: "pos_correcao" });
    await ctx.enviar(mensagemReescrita(retorno));
  });
  return "corretor:reescrita";
}

/**
 * Roda uma etapa lenta sem segurar o webhook. Se falhar, avisa o aluno e (com `voltarPara`)
 * devolve a sessão à etapa anterior, para ele tentar de novo sem perder o que mandou.
 */
function emBackground(ctx: Contexto, nome: string, fn: () => Promise<void>, voltarPara?: "resposta" | "confirmar"): void {
  const p = fn().catch(async (e) => {
    logger.error("corretor", `Falha ao ${nome}`, e);
    try {
      if (voltarPara) await atualizarSessao(ctx.conversaId, { etapa: voltarPara });
      const dica = voltarPara === "confirmar" ? "Digite *CORRIGIR* para tentar de novo."
        : voltarPara === "resposta" ? "Digite *PRONTO* para tentar de novo."
        : "Pode mandar de novo?";
      await ctx.enviar(e instanceof ErroAnexo
        ? `${e.message} Para recomeçar, digite */corrigir*.`
        : `Tive um problema agora 😕 ${dica}`);
    } catch (e2) {
      logger.error("corretor", "Falha ao avisar o aluno do erro", e2);
    }
  });
  void rastrear(p);
}

