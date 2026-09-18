import { describe, test, expect } from "bun:test";
import {
  PROMOCAO_DIA_CLIENTE,
  promocaoAtiva,
  tabelaPromocao,
  blocoPromocao,
  leadVeioDaPromocao,
  removerLinksDePagamento,
} from "../../src/lib/promocao.ts";
import { temPrecoDePlano } from "../../src/lib/planos.ts";
import { instanteDeParedeSP } from "../../src/config/agenda.ts";

describe("promocaoAtiva", () => {
  test("vale só em 18/09/2026, de 00h00 a 23h59 de Brasília", () => {
    expect(promocaoAtiva(instanteDeParedeSP(2026, 8, 17, 23, 59))).toBe(false);
    expect(promocaoAtiva(instanteDeParedeSP(2026, 8, 18, 0, 0))).toBe(true);
    expect(promocaoAtiva(instanteDeParedeSP(2026, 8, 18, 14, 30))).toBe(true);
    expect(promocaoAtiva(instanteDeParedeSP(2026, 8, 18, 23, 59))).toBe(true);
    expect(promocaoAtiva(instanteDeParedeSP(2026, 8, 19, 0, 0))).toBe(false);
  });
});

describe("tabela e bloco", () => {
  test("os 4 planos, com o 'de' riscado, o 'por' em negrito e o desconto em reais", () => {
    const t = tabelaPromocao();
    expect(t).toContain("Anual: ~12x R$ 394~ → *12x R$ 295* (R$ 1.000 de desconto)");
    expect(t).toContain("Semestral: ~12x R$ 246~ → *12x R$ 197* (R$ 500 de desconto)");
    expect(t).toContain("Anual: ~12x R$ 315~ → *12x R$ 246* (R$ 700 de desconto)");
    expect(t).toContain("Semestral: ~12x R$ 197~ → *12x R$ 167* (R$ 300 de desconto)");
    expect(t).not.toContain("—");
  });

  test("o maior desconto é mesmo de R$ 1.000 (é o que o template promete)", () => {
    const maior = Math.max(...PROMOCAO_DIA_CLIENTE.planos.map((p) => p.precoDe - p.precoPor));
    expect(maior).toBe(1000);
  });

  test("o bloco manda escalar em vez de mandar link", () => {
    const b = blocoPromocao();
    expect(b).toContain("NÃO ENVIE LINK DE PAGAMENTO HOJE");
    expect(b).toContain("Mostrar_condicao_dia_cliente");
    // O bloco não pode conter nada que, copiado ao lead, pareça instrução interna com a tabela.
    expect(b).not.toContain("SUBSTITUI");
    expect(b).not.toContain("~12x");
    expect(b).toContain("Escalar_humano");
    expect(b).toContain("🎯 PROMO DIA DO CLIENTE");
  });
});

describe("leadVeioDaPromocao", () => {
  test("reconhece o CTA dos templates e ignora conversa comum", () => {
    expect(leadVeioDaPromocao(["Oi, tudo bem? Aqui é o Walker. [...] Me responde eu quero que eu te mostro."])).toBe(true);
    expect(leadVeioDaPromocao(["Consigo te encaixar segunda às 9h.", "Fica em 12x de R$ 315 no cartão."])).toBe(false);
  });
});

describe("guardas de preço e link", () => {
  test("as travas reconhecem os valores promocionais como preço", () => {
    expect(temPrecoDePlano("Anual: ~12x R$ 394~ → *12x R$ 295*")).toBe(true);
    expect(temPrecoDePlano("Fica em 12x de R$ 167 no cartão")).toBe(true);
    expect(temPrecoDePlano("à vista sai R$ 2.997")).toBe(true);
  });

  test("removerLinksDePagamento tira só a linha do link", () => {
    const saida = "Fechado! Anual em 12x de R$ 246.\nhttps://peritowalker.com.br/mentoriaperitoanual\nQuando concluir me manda o comprovante.";
    expect(removerLinksDePagamento(saida)).toBe("Fechado! Anual em 12x de R$ 246.\nQuando concluir me manda o comprovante.");
  });
});
