import { describe, test, expect } from "bun:test";
import { classificarCompra, descricaoAposCompra, lerUltimaCompra, formatarUltimaCompra } from "../../src/lib/renovacao.ts";

const AGORA = new Date("2026-10-19T14:39:19Z"); // 11:39 em Brasília

describe("classificarCompra", () => {
  test("card sem boas-vindas: compra nova", () => {
    expect(classificarCompra("🟣 - Concurso: PCDF", AGORA)).toBe("nova");
  });

  // Conv 5699: card da compra de 12/08 (sem o marcador de data), renovou em 19/10.
  test("boas-vindas de meses atrás (fallback step_changed_at): renovação", () => {
    const desc = "💳 - Plano: Mentoria Vestigium - Perito Criminal - 6 meses\nboas-vindas: enviado";
    expect(classificarCompra(desc, AGORA, "2026-08-12T12:06:24.530Z")).toBe("renovacao");
  });

  test("marcador de última compra antigo: renovação mesmo com o mesmo plano", () => {
    const desc = "💳 - Plano: Anual\n🧾 - Última compra: 19/10/2025 10:00\nboas-vindas: enviado";
    expect(classificarCompra(desc, AGORA)).toBe("renovacao");
  });

  // Conv 9959: pix de entrada e restante no cartão chegam como ofertas diferentes no mesmo dia.
  test("segunda parte de venda dividida no mesmo dia: duplicada", () => {
    const desc = "💳 - Plano: 6 meses - Premium (pix entrada)\n🧾 - Última compra: 19/10/2026 08:00\nboas-vindas: enviado";
    expect(classificarCompra(desc, AGORA)).toBe("duplicada");
  });

  test("reenvio tardio do webhook (mesmo dia, via step_changed_at): duplicada", () => {
    expect(classificarCompra("boas-vindas: enviado", AGORA, "2026-10-19T14:00:00Z")).toBe("duplicada");
  });

  test("marcador de última compra tem prioridade sobre step_changed_at", () => {
    const desc = "🧾 - Última compra: 19/10/2026 11:00\nboas-vindas: enviado";
    expect(classificarCompra(desc, AGORA, "2026-01-01T00:00:00Z")).toBe("duplicada");
  });

  test("sem nenhuma data: duplicada (lado seguro, comportamento antigo)", () => {
    expect(classificarCompra("boas-vindas: enviado", AGORA)).toBe("duplicada");
  });
});

describe("marcador de última compra", () => {
  test("grava em Brasília e lê de volta o mesmo instante (precisão de minuto)", () => {
    const linha = formatarUltimaCompra(AGORA);
    expect(linha).toBe("🧾 - Última compra: 19/10/2026 11:39");
    expect(lerUltimaCompra(linha)?.toISOString()).toBe("2026-10-19T14:39:00.000Z");
  });
});

describe("descricaoAposCompra", () => {
  test("troca plano e última compra, mantém o resto e um só marcador de boas-vindas", () => {
    const antes = "🟣 - Concurso: PCDF\n💳 - Plano: 6 meses\n🧾 - Última compra: 12/08/2026 09:06\nboas-vindas: enviado";
    expect(descricaoAposCompra(antes, "Anual", AGORA)).toBe(
      "🟣 - Concurso: PCDF\n💳 - Plano: Anual\n🧾 - Última compra: 19/10/2026 11:39\nboas-vindas: enviado",
    );
  });

  test("card de lead (primeira compra) ganha as três linhas no fim", () => {
    expect(descricaoAposCompra("👤 - Descrição: em negociação", "6 meses", AGORA)).toBe(
      "👤 - Descrição: em negociação\n💳 - Plano: 6 meses\n🧾 - Última compra: 19/10/2026 11:39\nboas-vindas: enviado",
    );
  });

  test("descrição vazia não deixa linha em branco", () => {
    expect(descricaoAposCompra("", "Anual", AGORA).startsWith("💳")).toBe(true);
  });
});
