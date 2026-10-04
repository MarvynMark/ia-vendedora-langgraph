import { beforeEach, describe, expect, mock, test } from "bun:test";

// Banco simulado: histórico do lead (marcas "[enviado ao lead: ...]") + tabela midias_enviadas.
let historico: Array<{ session_id: string; content: string }> = [];
let tabela = new Set<string>();
let falhar = false;

mock.module("../../src/db/pool.ts", () => ({
  pool: {
    query: async (sql: string, params: string[] = []) => {
      if (falhar) throw new Error("banco fora");
      if (sql.includes("CREATE TABLE")) return { rowCount: 0, rows: [] };
      if (sql.includes("n8n_historico_mensagens")) {
        const achou = historico.some((h) => h.session_id === params[0] && h.content === params[1]);
        return { rowCount: achou ? 1 : 0, rows: [] };
      }
      if (sql.includes("INSERT INTO midias_enviadas")) {
        const k = `${params[0]}|${params[1]}`;
        if (tabela.has(k)) return { rowCount: 0, rows: [] };
        tabela.add(k);
        return { rowCount: 1, rows: [{}] };
      }
      return { rowCount: 0, rows: [] };
    },
  },
}));

const { reivindicarMidia, vincularTelefoneConversa } = await import("../../src/db/midias.ts");

beforeEach(() => { historico = []; tabela = new Set(); falhar = false; });

describe("reivindicarMidia", () => {
  test("primeira vez envia, segunda não (vale depois de restart, está no banco)", async () => {
    expect(await reivindicarMidia(9614, "áudio 1 do Walker")).toBe(true);
    expect(await reivindicarMidia(9614, "áudio 1 do Walker")).toBe(false);
    expect(await reivindicarMidia(9614, "áudio 2 do Walker")).toBe(true);
  });

  test("mídia já registrada no histórico do lead não sai de novo (antes da tabela existir)", async () => {
    vincularTelefoneConversa(9614, "+5563984184107");
    historico.push({ session_id: "+5563984184107", content: "[enviado ao lead: áudio 1 do Walker]" });
    expect(await reivindicarMidia(9614, "áudio 1 do Walker")).toBe(false);
  });

  test("banco fora do ar libera o envio (perder a mídia é pior que duplicar)", async () => {
    falhar = true;
    expect(await reivindicarMidia(1, "vídeo da plataforma")).toBe(true);
  });
});
