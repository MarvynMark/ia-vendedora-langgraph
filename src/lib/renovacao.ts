// Distingue, no webhook de pagamento, compra nova × reenvio da mesma compra × renovação.
//
// O marcador "boas-vindas: enviado" no card servia de backstop contra reenvio do webhook, mas
// barrava também quem compra de novo: 19/10/2026 (conv 5699), a aluna renovou para o Anual e o
// grupo não soube, porque o card ainda tinha o marcador da compra de agosto.
//
// O critério é o TEMPO desde a última compra, não o plano: venda dividida (pix de entrada + resto
// no cartão, conv 9959) chega como duas ofertas diferentes no mesmo dia e não é renovação.
// Reenvios em segundos/minutos já são barrados pelo lock de idempotência (TTL 5 min); a janela de
// 24h cobre os reenvios tardios e as vendas divididas.
//
// Função PURA e sem I/O (mesmo motivo de alerta-novo-aluno.ts: mock.module vaza entre arquivos).

export type TipoCompra = "nova" | "duplicada" | "renovacao";

const MARCADOR_BOAS_VINDAS = "boas-vindas: enviado";
const PREFIXO_ULTIMA_COMPRA = "🧾 - Última compra:";
const JANELA_DUPLICATA_MS = 24 * 60 * 60 * 1000;

export function lerUltimaCompra(descricao: string): Date | null {
  const m = descricao.match(/Última compra:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dia, mes, ano, hora, minuto] = m;
  // Gravado no horário de Brasília (sem horário de verão desde 2019).
  const data = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:00-03:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarUltimaCompra(agora: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(agora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${PREFIXO_ULTIMA_COMPRA} ${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

/**
 * @param stepChangedAt quando o card mudou de etapa pela última vez — fallback para cards
 *   anteriores ao marcador "Última compra" (o pagamento move o card para Ganho na compra).
 */
export function classificarCompra(descricao: string, agora: Date, stepChangedAt?: string): TipoCompra {
  if (!descricao.includes(MARCADOR_BOAS_VINDAS)) return "nova";

  const ultima = lerUltimaCompra(descricao) ?? (stepChangedAt ? new Date(stepChangedAt) : null);
  // Sem data nenhuma: comportamento antigo (ignorar), que é o lado seguro — não duplica o grupo.
  if (!ultima || Number.isNaN(ultima.getTime())) return "duplicada";

  return agora.getTime() - ultima.getTime() < JANELA_DUPLICATA_MS ? "duplicada" : "renovacao";
}

/**
 * Descrição do card após uma compra aprovada: troca a linha do plano e a da última compra pelas
 * novas (o card mantém uma só de cada — linkPrimeirosPassos lê a primeira "Plano:") e garante o
 * marcador de boas-vindas no fim.
 */
export function descricaoAposCompra(descricao: string, plano: string, agora: Date): string {
  const linhas = descricao
    .split("\n")
    .filter((l) => !/^💳 - Plano:/.test(l) && !l.startsWith(PREFIXO_ULTIMA_COMPRA) && l.trim() !== MARCADOR_BOAS_VINDAS);
  return [...linhas, `💳 - Plano: ${plano}`, formatarUltimaCompra(agora), MARCADOR_BOAS_VINDAS]
    .filter(Boolean)
    .join("\n");
}
