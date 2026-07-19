import { parse } from "node-html-parser";
import { env } from "../config/env.ts";
import { pool } from "../db/pool.ts";
import { logger } from "./logger.ts";
import { comRetry } from "./retry.ts";
import { fetchComTimeout } from "./fetch-with-timeout.ts";
import { enviarMensagem, reabrirConversa } from "../services/chatwoot.ts";

// Fontes de notícias monitoradas. Cada site tem sua própria estrutura HTML,
// então cada um define seus próprios seletores CSS. Adicionar uma fonte nova =
// mais um item neste array.
interface Fonte {
  nome: string;
  url: string;
  seletorItem: string;   // seleciona cada bloco de notícia
  seletorTitulo: string; // dentro do item, onde está o título (usa .text)
  seletorLink: string;   // dentro do item, onde está o link (usa href)
  viaProxy?: boolean;    // busca via Jina Reader (contorna Cloudflare que bloqueia o IP)
}

const FONTES: Fonte[] = [
  {
    nome: "estrategia",
    url: "https://www.estrategiaconcursos.com.br/blog/noticias/",
    seletorItem: "article",
    seletorTitulo: "h2",
    seletorLink: "a",
  },
  {
    // O Cloudflare do Gran Cursos bloqueia (403) o IP do servidor de produção.
    // Buscar via Jina Reader resolve: ele busca a página a partir dos servidores
    // dele e devolve o HTML original, que o mesmo parser abaixo consome.
    nome: "grancursos",
    url: "https://blog.grancursosonline.com.br/ultimas-noticias/",
    seletorItem: ".list-post",
    seletorTitulo: "h2 a",
    seletorLink: "h2 a",
    viaProxy: true,
  },
];

// Prefixo do leitor-proxy usado para fontes bloqueadas por IP.
const PROXY_PREFIXO = "https://r.jina.ai/";

// Headers completos de browser. Sites atrás de Cloudflare (ex: Gran Cursos) barram
// requisições "cruas" que só mandam User-Agent; o conjunto completo passa na checagem
// de integridade de browser mesmo a partir de IP de datacenter.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

interface Noticia {
  titulo: string;
  url: string;
  fonte: string;
}

// Normaliza texto para comparação: minúsculas + sem acentos.
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Lê os termos monitorados do env (separados por vírgula), normalizados.
function termosMonitorados(): string[] {
  return env.MONITOR_TERMOS.split(",")
    .map(t => normalizar(t))
    .filter(Boolean);
}

// Retorna o termo que casa com o título, ou null.
function termoQueCasa(titulo: string, termos: string[]): string | null {
  const t = normalizar(titulo);
  return termos.find(termo => t.includes(termo)) ?? null;
}

// Busca e faz parse de uma fonte, retornando as notícias encontradas.
async function coletarFonte(fonte: Fonte): Promise<Noticia[]> {
  // Fontes bloqueadas por IP são buscadas via Jina Reader, pedindo o HTML original
  // (X-Return-Format: html) para que o mesmo parser abaixo funcione sem alteração.
  const alvo = fonte.viaProxy ? `${PROXY_PREFIXO}${fonte.url}` : fonte.url;
  const headers = fonte.viaProxy
    ? { ...BROWSER_HEADERS, "X-Return-Format": "html" }
    : BROWSER_HEADERS;
  // O proxy adiciona latência (busca a página remotamente), então damos mais tempo.
  const timeout = fonte.viaProxy ? 30000 : 15000;

  const res = await comRetry(
    () => fetchComTimeout(alvo, { timeout, headers }),
    3,
    1000,
  );
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  const html = await res.text();
  const root = parse(html);

  const noticias: Noticia[] = [];
  for (const item of root.querySelectorAll(fonte.seletorItem)) {
    const titulo = item.querySelector(fonte.seletorTitulo)?.text.trim();
    const url = item.querySelector(fonte.seletorLink)?.getAttribute("href")?.trim();
    if (titulo && url) {
      noticias.push({ titulo, url, fonte: fonte.nome });
    }
  }
  return noticias;
}

// Envia o alerta da notícia para o grupo da mentoria (mesma conversa do alerta
// de "novo aluno") e reabre a conversa.
async function enviarAlerta(noticia: Noticia, termo: string) {
  const mensagem =
    `🚨 NOVA NOTÍCIA — ${termo}\n${noticia.titulo}\n${noticia.url}\n\n_Fonte: ${noticia.fonte}_`;
  await enviarMensagem(
    env.CHATWOOT_ACCOUNT_ID,
    env.CHATWOOT_ALERT_CONVERSATION_ID,
    mensagem,
  );
  await reabrirConversa(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID);
}

interface ResultadoVerificacao {
  termos: string[];
  fontes: Array<{ nome: string; total: number; erro?: string }>;
  novas: number;
  enviadas: number;
  primeiraExecucao: boolean;
}

/**
 * Varre todas as fontes, deduplicando por URL via banco. Na primeira execução
 * (tabela vazia) apenas registra o baseline sem enviar nada. Depois disso, cada
 * notícia nova cujo título casa com um termo monitorado gera um alerta no grupo.
 *
 * @param opts.forcar  Se true, envia a notícia casada mais recente mesmo que já
 *                     tenha sido vista — usado pela rota de teste.
 */
export async function verificarNoticias(
  opts: { forcar?: boolean } = {},
): Promise<ResultadoVerificacao> {
  const termos = termosMonitorados();
  const resultado: ResultadoVerificacao = {
    termos,
    fontes: [],
    novas: 0,
    enviadas: 0,
    primeiraExecucao: false,
  };

  // Coleta todas as fontes (falha em uma não derruba a outra).
  const todas: Noticia[] = [];
  for (const fonte of FONTES) {
    try {
      const noticias = await coletarFonte(fonte);
      todas.push(...noticias);
      resultado.fontes.push({ nome: fonte.nome, total: noticias.length });
      logger.info("monitor-noticias", `Fonte ${fonte.nome}: ${noticias.length} notícia(s)`);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      resultado.fontes.push({ nome: fonte.nome, total: 0, erro });
      logger.error("monitor-noticias", `Erro ao coletar fonte ${fonte.nome}:`, e);
    }
  }

  // Modo forçar: prova a entrega no grupo sem depender de haver notícia casando agora.
  // Se houver uma notícia que casa, envia o alerta real dela. Caso contrário, envia uma
  // mensagem claramente marcada como TESTE usando a notícia mais recente como exemplo do
  // formato — assim a entrega fica comprovada sem fingir um alerta verdadeiro.
  if (opts.forcar) {
    const casada = todas.find(n => termoQueCasa(n.titulo, termos));
    if (casada) {
      const termo = termoQueCasa(casada.titulo, termos)!;
      await enviarAlerta(casada, termo);
      resultado.enviadas = 1;
      logger.info("monitor-noticias", `[forçar] alerta real enviado: ${casada.titulo}`);
      return resultado;
    }
    const exemplo = todas[0];
    const corpo = exemplo
      ? `🧪 TESTE — Monitor de notícias ativo ✅\n\nO robô está funcionando e vigiando os sites de concursos. Assim que surgir uma notícia com *"${env.MONITOR_TERMOS}"* no título, o alerta chega aqui automaticamente, neste formato:\n\n🚨 NOVA NOTÍCIA\n${exemplo.titulo}\n${exemplo.url}\n\n_(Esta é só uma mensagem de teste — a notícia acima é um exemplo do feed atual, não um alerta real.)_`
      : `🧪 TESTE — Monitor de notícias ativo ✅\n\nO robô está funcionando, mas não consegui ler notícias das fontes neste momento.`;
    await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID, corpo);
    await reabrirConversa(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID);
    resultado.enviadas = 1;
    logger.info("monitor-noticias", "[forçar] mensagem de teste enviada (nenhuma notícia casava no momento)");
    return resultado;
  }

  const { rows } = await pool.query<{ total: string }>("SELECT COUNT(*)::int AS total FROM noticias_vistas");
  const primeiraExecucao = Number(rows[0]?.total ?? 0) === 0;
  resultado.primeiraExecucao = primeiraExecucao;

  for (const n of todas) {
    // INSERT idempotente: se a url já existe, não faz nada e não retorna linha.
    const ins = await pool.query(
      `INSERT INTO noticias_vistas (url, titulo, termo)
       VALUES ($1, $2, $3)
       ON CONFLICT (url) DO NOTHING
       RETURNING url`,
      [n.url, n.titulo, termoQueCasa(n.titulo, termos)],
    );
    const ehNova = (ins.rowCount ?? 0) > 0;
    if (!ehNova) continue;
    resultado.novas++;

    if (primeiraExecucao) continue; // baseline silencioso

    const termo = termoQueCasa(n.titulo, termos);
    if (termo) {
      await enviarAlerta(n, termo);
      resultado.enviadas++;
      logger.info("monitor-noticias", `Alerta enviado (${n.fonte}): ${n.titulo}`);
    }
  }

  if (primeiraExecucao) {
    logger.info("monitor-noticias", `Baseline criado com ${resultado.novas} notícia(s) — nenhum alerta enviado`);
  } else {
    logger.info("monitor-noticias", `Verificação concluída: ${resultado.novas} nova(s), ${resultado.enviadas} alerta(s)`);
  }

  return resultado;
}
