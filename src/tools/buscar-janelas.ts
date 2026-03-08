import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buscarProfissional } from "../config/profissionais.ts";
import { listarEventos } from "../services/google-calendar.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

const TAMANHOS_VALIDOS = [10, 15, 20, 30, 45, 60, 90, 120];

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function getSpComponents(date: Date): { dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.TZ,
    hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  return {
    dayOfWeek: WEEKDAY_MAP[parts.find(p => p.type === "weekday")?.value ?? "Sun"] ?? 0,
    hour: Number(parts.find(p => p.type === "hour")?.value ?? "0"),
    minute: Number(parts.find(p => p.type === "minute")?.value ?? "0"),
  };
}

export const buscarJanelasDisponiveis = tool(
  async (input) => {
    logger.info("tool:buscar-janelas", "Buscando janelas", {
      profissional: input.idProfissional,
      tamanho: input.tamanhoJanelaMinutos,
      inicio: input.periodoInicio,
      fim: input.periodoFim,
      granularidade: input.granularidade,
      amostras: input.amostras,
    });
    // Validar tamanho da janela
    if (!TAMANHOS_VALIDOS.includes(input.tamanhoJanelaMinutos)) {
      return JSON.stringify({
        erro: `Tamanho de janela inválido. Use um dos valores: ${TAMANHOS_VALIDOS.join(", ")}`,
      });
    }

    // Validar período início
    const inicio = new Date(input.periodoInicio);
    if (inicio < new Date()) {
      return JSON.stringify({
        erro: "O período de início deve ser no futuro.",
      });
    }

    // Buscar profissional
    const profissional = buscarProfissional(input.idProfissional);
    if (!profissional) {
      return JSON.stringify({
        erro: `Profissional "${input.idProfissional}" não encontrado.`,
      });
    }

    const fim = new Date(input.periodoFim);
    const granularidade = input.granularidade ?? 30;
    if (!TAMANHOS_VALIDOS.includes(granularidade)) {
      return JSON.stringify({
        erro: `Granularidade inválida. Use um dos valores: ${TAMANHOS_VALIDOS.join(", ")}`,
      });
    }
    const amostras = input.amostras;

    // Buscar eventos existentes do Google Calendar
    let eventos: Awaited<ReturnType<typeof listarEventos>> = [];
    try {
      eventos = await listarEventos(
        profissional.calendarId,
        input.periodoInicio,
        input.periodoFim,
      );
    } catch (e) {
      logger.error("tool:buscar-janelas", "Erro:", e);
      return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
    }

    // Gerar janelas de tempo
    const janelas: Array<{ inicioJanela: string; fimJanela: string; idAgenda: string }> = [];
    const cursor = new Date(inicio);

    while (cursor < fim) {
      const fimJanela = new Date(cursor.getTime() + input.tamanhoJanelaMinutos * 60000);

      if (fimJanela > fim) break;

      // Verificar dia da semana na disponibilidade do profissional (em horário de São Paulo)
      const sp = getSpComponents(cursor);
      const spFim = getSpComponents(fimJanela);
      const diaSemana = sp.dayOfWeek;
      const periodos = profissional.disponibilidade[diaSemana];

      if (periodos && periodos.length > 0) {
        const minutosCursor = sp.hour * 60 + sp.minute;
        const minutosFimJanela = spFim.hour * 60 + spFim.minute;

        // Verificar se a janela cabe em ALGUM dos períodos
        const cabeEmAlgumPeriodo = periodos.some((periodo) => {
          const [hInicio, mInicio] = periodo.inicio.split(":").map(Number);
          const [hFim, mFim] = periodo.fim.split(":").map(Number);
          const minutosDispInicio = (hInicio ?? 0) * 60 + (mInicio ?? 0);
          const minutosDispFim = (hFim ?? 0) * 60 + (mFim ?? 0);
          return minutosCursor >= minutosDispInicio && minutosFimJanela <= minutosDispFim;
        });

        if (cabeEmAlgumPeriodo) {
          // Verificar conflito com eventos existentes
          const temConflito = eventos.some((evento) => {
            const evInicio = new Date(evento.start?.dateTime ?? evento.start?.date ?? "");
            const evFim = new Date(evento.end?.dateTime ?? evento.end?.date ?? "");
            return cursor < evFim && fimJanela > evInicio;
          });

          if (!temConflito) {
            janelas.push({
              inicioJanela: cursor.toISOString(),
              fimJanela: fimJanela.toISOString(),
              idAgenda: profissional.calendarId,
            });
          }
        }
      }

      cursor.setTime(cursor.getTime() + granularidade * 60000);
    }

    logger.info("tool:buscar-janelas", `${janelas.length} janelas encontradas, ${eventos.length} eventos existentes`);

    // Randomizar, amostrar e reordenar
    let resultado = [...janelas];

    if (amostras && amostras < resultado.length) {
      // Shuffle Fisher-Yates
      for (let i = resultado.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [resultado[i], resultado[j]] = [resultado[j]!, resultado[i]!];
      }
      resultado = resultado.slice(0, amostras);
      // Reordenar cronologicamente
      resultado.sort((a, b) => new Date(a.inicioJanela).getTime() - new Date(b.inicioJanela).getTime());
    }

    return JSON.stringify(resultado);
  },
  {
    name: "Buscar_janelas_disponiveis",
    description: "Utilize essa ferramenta para buscar as janelas disponíveis no um período especificado. Evite utilizar com janelas de tamanho muito grandes e muito pequenas. Por exemplo, considerando disponibilidade já informada das 08h às 19h:\n\n* Para janelas maiores, não busque com período fora do horário de disponibilidade já informado nas instruções.\n\n\"Quais janelas estão disponíveis amanhã?\"\n- Período início: 08h, período fim: 19h\n- (Ao invés de 00h às 00h do dia seguinte)\n\n* Para janelas menores, insira uma margem antes e depois do horário desejado.\n\n\"O horário das 12h está disponível?\"\n- Período início: 10h, período fim: 14h\n- (Ao invés de 12h às 12h30, para tamanho de janela de 30m)\n\n* Para janelas muito próximas do horário atual, certifique-se de não consultar com período início no passado.\n\n\"Tem algum horário agora de manhã?\" (Mensagem recebida às 09:40)\n- Período início: 10h, período fim: 12h\n- (Ao invés de 09h às 12h, pois 09h já passou) ",
    schema: z.object({
      idProfissional: z.string().describe("Slug do profissional (ex: dra-ana-costa)"),
      tamanhoJanelaMinutos: z.number().describe("Duração do procedimento em minutos"),
      periodoInicio: z.string().describe("Data/hora inicial no formato YYYY-MM-DDThh:mm:ssTZD"),
      periodoFim: z.string().describe("Data/hora final no formato YYYY-MM-DDThh:mm:ssTZD"),
      granularidade: z.number().default(30).describe("Intervalo entre janelas em minutos"),
      amostras: z.number().optional().describe("Número máximo de janelas a retornar"),
    }),
  },
);
