import { Elysia } from "elysia";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import {
  type CadastroBlack,
  type PesquisaBlack,
  COLUNAS,
  ETIQUETA_BLACK,
  ORIGEM_BLACK,
  atributosDaPesquisa,
  chaveColuna,
  eventoBlackSchema,
  telefoneE164,
  valoresDaPesquisa,
  valoresDoCadastro,
} from "../lib/lead-black.ts";
import { gravarLeadBlack, planilhaBlackConfigurada } from "../services/google-sheets.ts";
import {
  adicionarEtiquetasContato,
  atualizarContato,
  atualizarContatoDados,
  buscarContatoPorQuery,
  criarContato,
} from "../services/chatwoot.ts";
import { nomeEhPlaceholderContato } from "./aplicacao-mentoria.ts";

// Recebe a LP lp.mentoriavestigium.com.br/lista-vip (Black Antecipada, 03/11/2026): cadastro e mini
// pesquisa vão para a aba black-2026 da planilha "LEADS - OPERACAO PERITO" e para o contato no
// Chatwoot, com a etiqueta black-2026. Só contato: nenhuma conversa é aberta, então a IA não fala
// com o lead por causa desta rota.

// Últimos envios, SEM dados pessoais: a rota de logs é pública.
const MAX_LOGS = 30;
const logs: Array<{ timestamp: string; evento: string; lead_id: string; resultado: string }> = [];
function registrarLog(evento: string, leadId: string, resultado: string) {
  logs.unshift({ timestamp: new Date().toISOString(), evento, lead_id: leadId, resultado });
  if (logs.length > MAX_LOGS) logs.pop();
}

/** Contato pelo telefone (com e sem o nono dígito, que alguns contatos antigos não têm) ou e-mail. */
async function acharContato(telefone: string, email?: string) {
  const conta = env.CHATWOOT_ACCOUNT_ID;
  const tentativas = [telefone];
  const d = telefone.replace(/\D/g, "");
  if (d.length === 13 && d[4] === "9") tentativas.push(`+${d.slice(0, 4)}${d.slice(5)}`);
  if (email) tentativas.push(email);
  for (const q of tentativas) {
    const c = await buscarContatoPorQuery(conta, q);
    if (c) return c;
  }
  return null;
}

async function cadastroNoChatwoot(c: CadastroBlack): Promise<number> {
  const conta = env.CHATWOOT_ACCOUNT_ID;
  const telefone = telefoneE164(c.whatsapp);
  const existente = await acharContato(telefone, c.email);
  let id: number;
  if (existente) {
    id = existente.id;
    // Só completa o que falta: nome real e e-mail já gravados não são trocados.
    const dados: { name?: string; email?: string } = {};
    if (nomeEhPlaceholderContato(existente.name)) dados.name = c.nome;
    if (!existente.email) dados.email = c.email;
    if (Object.keys(dados).length) await atualizarContatoDados(conta, id, dados);
  } else {
    id = (await criarContato(conta, { name: c.nome, phone_number: telefone, email: c.email })).id;
  }
  await atualizarContato(conta, id, { origem_black: ORIGEM_BLACK, ...(c.utm_campaign ? { black_utm_campaign: c.utm_campaign } : {}) });
  await adicionarEtiquetasContato(conta, id, [ETIQUETA_BLACK]);
  return id;
}

async function processarCadastro(c: CadastroBlack, recebidoEm: Date) {
  // Planilha e Chatwoot independentes: uma falha não impede a outra.
  if (planilhaBlackConfigurada()) {
    try {
      await gravarLeadBlack(c.lead_id, valoresDoCadastro(c, recebidoEm));
      registrarLog("cadastro", c.lead_id, "planilha:ok");
    } catch (e) {
      logger.error("lead-black", "Erro ao gravar cadastro na planilha:", e);
      registrarLog("cadastro", c.lead_id, `planilha:erro:${String(e).slice(0, 200)}`);
    }
  }
  try {
    const id = await cadastroNoChatwoot(c);
    registrarLog("cadastro", c.lead_id, `chatwoot:ok:${id}`);
  } catch (e) {
    logger.error("lead-black", "Erro ao salvar contato no Chatwoot:", e);
    registrarLog("cadastro", c.lead_id, `chatwoot:erro:${String(e).slice(0, 200)}`);
  }
}

async function processarPesquisa(p: PesquisaBlack) {
  // O telefone para achar o contato vem da linha do lead na planilha (a pesquisa não traz contato).
  if (!planilhaBlackConfigurada()) return;
  let telefone = "";
  try {
    const linha = await gravarLeadBlack(p.lead_id, valoresDaPesquisa(p));
    const digitos = (linha[chaveColuna(COLUNAS.whatsapp)] ?? "").replace(/\D/g, "");
    telefone = digitos ? telefoneE164(digitos) : "";
    registrarLog("pesquisa", p.lead_id, "planilha:ok");
  } catch (e) {
    logger.error("lead-black", "Erro ao gravar pesquisa na planilha:", e);
    registrarLog("pesquisa", p.lead_id, `planilha:erro:${String(e).slice(0, 200)}`);
    return;
  }
  const atributos = atributosDaPesquisa(p);
  if (!telefone || !Object.keys(atributos).length) return;
  try {
    const contato = await acharContato(telefone);
    if (!contato) {
      registrarLog("pesquisa", p.lead_id, "chatwoot:sem_contato");
      return;
    }
    await atualizarContato(env.CHATWOOT_ACCOUNT_ID, contato.id, atributos);
    registrarLog("pesquisa", p.lead_id, `chatwoot:ok:${contato.id}`);
  } catch (e) {
    logger.error("lead-black", "Erro ao salvar pesquisa no Chatwoot:", e);
    registrarLog("pesquisa", p.lead_id, `chatwoot:erro:${String(e).slice(0, 200)}`);
  }
}

export const leadBlackRouter = new Elysia()
  .post("/webhook/lead-black", ({ body, set }) => {
    const parsed = eventoBlackSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("lead-black", "Payload inválido:", parsed.error.issues);
      set.status = 400;
      return { status: "error", reason: "invalid_payload" };
    }
    const ev = parsed.data;
    registrarLog(ev.evento, ev.lead_id, "recebido");
    // Responde na hora: a página espera a resposta antes de ir para o obrigado.
    const tarefa = ev.evento === "cadastro" ? processarCadastro(ev, new Date()) : processarPesquisa(ev);
    void tarefa.catch(e => logger.error("lead-black", "Erro inesperado:", e));
    return { status: "ok" };
  })
  .get("/webhook/logs-lead-black", () => logs);
