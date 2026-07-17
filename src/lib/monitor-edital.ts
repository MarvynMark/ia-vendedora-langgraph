import { env } from "../config/env.ts";
import { pool } from "../db/pool.ts";
import { logger } from "./logger.ts";
import { comRetry } from "./retry.ts";
import { fetchComTimeout } from "./fetch-with-timeout.ts";
import { enviarMensagem, reabrirConversa } from "../services/chatwoot.ts";

// Concursos monitorados. Adicionar um concurso novo = mais um item aqui.
// `identificador` é o slug da URL do Cebraspe (.../concursos/<identificador>) e
// também a chave da API oficial (.../cebraspe/eventos/<identificador>).
interface ConcursoMonitorado {
  identificador: string;
  apelido: string; // nome curto pra logs
}

const CONCURSOS: ConcursoMonitorado[] = [
  { identificador: "PERICIA_OFICIAL_MA_26", apelido: "Perícia MA" },
];

// API JSON que o próprio SPA do Cebraspe consome — muito mais estável que raspar o
// HTML renderizado (que exige JS e vinha inconsistente via proxy). O detalhe do
// concurso traz `arquivosEdital`: vazio antes da publicação, preenchido depois.
const API_BASE = "https://apis.cebraspe.org.br/cebraspe/eventos";
const CDN_RAIZ = "https://cdn.cebraspe.org.br/";
const CDN_CONCURSOS = "https://cdn.cebraspe.org.br/concursos";
const PAGINA_BASE = "https://www.cebraspe.org.br/concursos";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

interface ArquivoEdital {
  nomeArquivo?: string;
  descricaoArquivo?: string;
  isGuid?: boolean;
}

interface EventoDetalhe {
  eventoNomeCompleto?: string;
  eventoTotalVagas?: number | string;
  strEventoSalarioMaximo?: string;
  periodoInscricao?: string;
  eventoTipo?: string;
  arquivosEdital?: ArquivoEdital[] | null;
}

async function buscarEvento(identificador: string): Promise<EventoDetalhe> {
  const res = await comRetry(
    () => fetchComTimeout(`${API_BASE}/${identificador}`, { timeout: 15000, headers: HEADERS }),
    3,
    1000,
  );
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as EventoDetalhe;
}

// Monta a URL pública do arquivo do edital. Regra extraída do próprio bundle do
// site: se isGuid, é CDN_RAIZ + nomeArquivo; senão, CDN + tipo(concursos) + id.
function urlArquivo(identificador: string, arq: ArquivoEdital): string {
  if (arq.isGuid) return `${CDN_RAIZ}${arq.nomeArquivo}`;
  return `${CDN_CONCURSOS}/${identificador}/arquivos/${arq.nomeArquivo}`;
}

// Variantes de acessibilidade (Vlibras) poluem o alerta — são registradas como
// vistas, mas não entram na mensagem enviada ao grupo.
function ehVlibras(arq: ArquivoEdital): boolean {
  return /vlibras/i.test(arq.descricaoArquivo ?? "");
}

function montarMensagem(evento: EventoDetalhe, identificador: string, novos: ArquivoEdital[]): string {
  const nome = evento.eventoNomeCompleto ?? identificador;
  const linhasDocs = novos
    .map(a => `📄 *${a.descricaoArquivo ?? "Edital"}*\n👉 ${urlArquivo(identificador, a)}`)
    .join("\n\n");

  return [
    "🚨🚨🚨 *SAIU O EDITAL!* 🚨🚨🚨",
    "",
    `📢 *${nome}*`,
    "",
    evento.eventoTotalVagas ? `🎯 Vagas: *${evento.eventoTotalVagas}*` : "",
    evento.strEventoSalarioMaximo ? `💰 Remuneração: até *${evento.strEventoSalarioMaximo}*` : "",
    evento.periodoInscricao ? `📅 Inscrições: ${evento.periodoInscricao}` : "",
    "",
    linhasDocs,
    "",
    `🔗 Página oficial: ${PAGINA_BASE}/${identificador}`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // colapsa quebras extras (ex.: sem linha de vagas/salário)
    .trim();
}

async function enviarAlerta(mensagem: string) {
  await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID, mensagem);
  await reabrirConversa(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID);
}

interface ResultadoEdital {
  concursos: Array<{ identificador: string; arquivos: number; novos: number; erro?: string }>;
  enviadas: number;
}

/**
 * Consulta cada concurso monitorado na API do Cebraspe. Para cada arquivo de
 * edital ainda não visto (dedup por nomeArquivo no banco), envia UM alerta no
 * grupo. Diferente do monitor de notícias, aqui NÃO há baseline silencioso: o
 * objetivo é justamente avisar quando o edital aparecer — se por acaso o serviço
 * subir depois da publicação, o alerta ainda dispara (uma vez).
 *
 * @param opts.forcar  Envia uma mensagem de TESTE (sem gravar no banco), provando
 *                     a entrega no grupo mesmo antes de o edital sair.
 */
export async function verificarEditais(opts: { forcar?: boolean } = {}): Promise<ResultadoEdital> {
  const resultado: ResultadoEdital = { concursos: [], enviadas: 0 };

  for (const concurso of CONCURSOS) {
    try {
      const evento = await buscarEvento(concurso.identificador);
      const arquivos = (evento.arquivosEdital ?? []).filter(a => a.nomeArquivo);

      // Modo teste: prova a entrega sem depender de o edital existir e sem gravar dedup.
      if (opts.forcar) {
        const nome = evento.eventoNomeCompleto ?? concurso.identificador;
        const corpo = arquivos.length
          ? `🧪 TESTE — Monitor de edital ativo ✅\n\nJá há edital publicado para *${nome}*. Quando surgir um documento novo, o alerta chega aqui neste formato:\n\n${montarMensagem(evento, concurso.identificador, arquivos.filter(a => !ehVlibras(a)))}`
          : `🧪 TESTE — Monitor de edital ativo ✅\n\nEstou vigiando *${nome}* a cada ${Math.round(env.MONITOR_EDITAL_INTERVALO_MS / 60000)} min. O edital ainda não saiu (arquivosEdital vazio). Assim que sair, o alerta chega aqui automaticamente.`;
        await enviarAlerta(corpo);
        resultado.enviadas++;
        resultado.concursos.push({ identificador: concurso.identificador, arquivos: arquivos.length, novos: 0 });
        logger.info("monitor-edital", `[forçar] mensagem de teste enviada (${concurso.apelido})`);
        continue;
      }

      // Dedup por arquivo: INSERT idempotente; só retorna linha se for novo.
      const novos: ArquivoEdital[] = [];
      for (const a of arquivos) {
        const ins = await pool.query(
          `INSERT INTO editais_vistos (nome_arquivo, identificador, descricao)
           VALUES ($1, $2, $3)
           ON CONFLICT (nome_arquivo) DO NOTHING
           RETURNING nome_arquivo`,
          [a.nomeArquivo, concurso.identificador, a.descricaoArquivo ?? null],
        );
        if ((ins.rowCount ?? 0) > 0) novos.push(a);
      }

      resultado.concursos.push({ identificador: concurso.identificador, arquivos: arquivos.length, novos: novos.length });

      // Vlibras entra no dedup (não realerta), mas fica fora da mensagem.
      const novosParaAlerta = novos.filter(a => !ehVlibras(a));
      if (novosParaAlerta.length > 0) {
        await enviarAlerta(montarMensagem(evento, concurso.identificador, novosParaAlerta));
        resultado.enviadas++;
        logger.info("monitor-edital", `🚨 EDITAL detectado (${concurso.apelido}): ${novosParaAlerta.map(a => a.descricaoArquivo).join(", ")}`);
      } else if (novos.length > 0) {
        logger.info("monitor-edital", `${novos.length} arquivo(s) novo(s) só de Vlibras (${concurso.apelido}) — sem alerta`);
      } else {
        logger.info("monitor-edital", `Sem novidade em ${concurso.apelido} (${arquivos.length} arquivo(s) já visto(s))`);
      }
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      resultado.concursos.push({ identificador: concurso.identificador, arquivos: 0, novos: 0, erro });
      logger.error("monitor-edital", `Erro ao verificar ${concurso.apelido}:`, e);
    }
  }

  return resultado;
}
