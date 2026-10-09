// Encanamento do Google Sheets para o cadastro dos novos alunos. Quem DECIDE em que coluna vai
// cada resposta é lib/planilha-alunos.ts, que é puro e testável; aqui só entra o que precisa de rede.
//
// Mesma autorização OAuth do Google Calendar (ver services/google-calendar.ts), da conta
// contato@csiacademy.com.br: o refresh token precisa ter também o escopo de planilhas
// (src/scripts/autorizar-agenda.ts já pede os dois), e essa conta precisa ser Editor da planilha.

import { google, type sheets_v4 } from "googleapis";
import { env } from "../config/env.ts";
import type { Respostas } from "../lib/diagnostico-inicial.ts";
import { montarLinhaPlanilha } from "../lib/planilha-alunos.ts";
import { logger } from "../lib/logger.ts";

let clienteCache: sheets_v4.Sheets | null = null;

function planilhas(): sheets_v4.Sheets {
  if (clienteCache) return clienteCache;
  const oauth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  clienteCache = google.sheets({ version: "v4", auth: oauth });
  return clienteCache;
}

export function planilhaAlunosConfigurada(): boolean {
  return Boolean(
    env.PLANILHA_ALUNOS_ID &&
      env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

type Aba = { titulo: string; colunas: number; tabela: sheets_v4.Schema$Table | null };

/**
 * A aba pelo gid do link (o nome pode ser trocado na planilha, o gid não muda), com o total de
 * colunas da grade e a Tabela "Form_Responses1" que o Forms criou sobre as respostas.
 */
async function lerAba(api: sheets_v4.Sheets): Promise<Aba> {
  const { data } = await api.spreadsheets.get({
    spreadsheetId: env.PLANILHA_ALUNOS_ID,
    fields: "sheets(properties(sheetId,title,gridProperties.columnCount),tables(tableId,range))",
  });
  const aba = data.sheets?.find(s => s.properties?.sheetId === env.PLANILHA_ALUNOS_GID);
  if (!aba?.properties?.title) throw new Error(`Aba gid=${env.PLANILHA_ALUNOS_GID} não encontrada na planilha`);
  return {
    titulo: aba.properties.title,
    colunas: aba.properties.gridProperties?.columnCount ?? 0,
    tabela: aba.tables?.[0] ?? null,
  };
}

/** Linha (1-based) de "'Aba'!A903:BD903", o intervalo que o append devolve. */
export function linhaDoIntervalo(intervalo: string | null | undefined): number | null {
  const m = intervalo?.match(/![A-Z]+(\d+)/);
  return m ? Number(m[1]) : null;
}

// Uma gravação por vez: dois diagnósticos chegando juntos com pergunta nova criariam a mesma
// coluna duas vezes, cada um lendo o cabeçalho antes do outro gravar.
let fila: Promise<unknown> = Promise.resolve();

export function anexarCadastroAluno(opts: {
  respostas: Respostas;
  concurso: string | null;
  roteiro: string | null;
  recebidoEm: Date;
}): Promise<void> {
  const tarefa = fila.then(async () => {
    const api = planilhas();
    const spreadsheetId = env.PLANILHA_ALUNOS_ID;
    const sheetId = env.PLANILHA_ALUNOS_GID;
    const aba = await lerAba(api);
    const nome = `'${aba.titulo.replace(/'/g, "''")}'`;

    const { data } = await api.spreadsheets.values.get({ spreadsheetId, range: `${nome}!1:1` });
    const atual = (data.values?.[0] ?? []).map(v => String(v ?? ""));
    const { cabecalho, cabecalhoMudou, linha } = montarLinhaPlanilha({ ...opts, cabecalho: atual });

    // A grade tem um número fixo de colunas (35 em out/2026) e gravar além dele dá erro.
    if (cabecalho.length > aba.colunas) {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: cabecalho.length - aba.colunas } }] },
      });
    }

    if (cabecalhoMudou) {
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `${nome}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [cabecalho] },
      });
      logger.info("planilha-alunos", "Colunas novas no cabeçalho", { novas: cabecalho.slice(atual.length) });
    }

    // USER_ENTERED para o carimbo virar data, como no Forms. Respostas que pareceriam fórmula
    // já vêm protegidas por comoTexto().
    const { data: anexo } = await api.spreadsheets.values.append({
      spreadsheetId,
      range: `${nome}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [linha] },
    });

    // A Tabela do Forms não cresce sozinha com o que a API grava: estende até a linha nova e as
    // colunas novas, para os filtros e a formatação valerem para elas também. Se falhar, a linha
    // já está gravada; só fica fora da Tabela.
    const r = aba.tabela?.range;
    const linhaGravada = linhaDoIntervalo(anexo.updates?.updatedRange);
    if (aba.tabela?.tableId && r && linhaGravada) {
      const fimLinha = Math.max(r.endRowIndex ?? 0, linhaGravada);
      const fimColuna = Math.max(r.endColumnIndex ?? 0, cabecalho.length);
      if (fimLinha !== r.endRowIndex || fimColuna !== r.endColumnIndex) {
        try {
          await api.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                updateTable: {
                  table: { tableId: aba.tabela.tableId, range: { ...r, endRowIndex: fimLinha, endColumnIndex: fimColuna } },
                  fields: "range",
                },
              }],
            },
          });
        } catch (e) {
          logger.warn("planilha-alunos", "Linha gravada, mas a Tabela não foi estendida", { erro: String(e).slice(0, 300) });
        }
      }
    }
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}
