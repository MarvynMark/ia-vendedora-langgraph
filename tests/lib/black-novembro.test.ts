import { describe, test, expect } from "bun:test";
import {
  BLACK_NOVEMBRO,
  blackNovembroAtiva,
  trocarLinksPelaBlack,
  blocoBlackNovembroPerito,
  blocoBlackNovembroMedico,
} from "../../src/lib/black-novembro.ts";
import { temPrecoDePlano, temLinkDePagamento, planosCitados, conferirFormaDePagamento } from "../../src/lib/planos.ts";
import { instanteDeParedeSP } from "../../src/config/agenda.ts";

describe("blackNovembroAtiva", () => {
  test("vale de 12/11 00h00 a 30/11 23h59 de Brasília", () => {
    expect(blackNovembroAtiva(instanteDeParedeSP(2026, 10, 11, 23, 59))).toBe(false);
    expect(blackNovembroAtiva(instanteDeParedeSP(2026, 10, 12, 0, 0))).toBe(true);
    expect(blackNovembroAtiva(instanteDeParedeSP(2026, 10, 20, 15, 0))).toBe(true);
    expect(blackNovembroAtiva(instanteDeParedeSP(2026, 10, 30, 23, 59))).toBe(true);
    expect(blackNovembroAtiva(instanteDeParedeSP(2026, 11, 1, 0, 0))).toBe(false);
  });
});

describe("trocarLinksPelaBlack", () => {
  test("troca os links de cartão do preço cheio pelos da Black do mesmo plano", () => {
    const L = BLACK_NOVEMBRO.links;
    expect(trocarLinksPelaBlack("https://peritowalker.com.br/mentoriaperitoanualpremium").texto).toBe(L.anualMaterial);
    expect(trocarLinksPelaBlack("https://peritowalker.com.br/mentoriaperitoanual").texto).toBe(L.anual);
    expect(trocarLinksPelaBlack("https://peritowalker.com.br/mentoriaperito").texto).toBe(L.semestral);
    expect(trocarLinksPelaBlack("https://peritowalker.com.br/mentoriaperitosemestralpremium1").texto).toBe(L.semestral);
    expect(trocarLinksPelaBlack("https://peritowalker.com.br/mentorialegistaanual").texto).toBe(L.medicoAnual);
  });

  test("não mexe em parcelado, Trimestral nem no Semestral do Médico Legista", () => {
    for (const slug of ["mentoriaperitoanualparcelado", "mentoriaperitoparcelado", "mentoriaperitotrimestral", "medicolegista", "mentoriaperitoanualpremiumparcelado"]) {
      const r = trocarLinksPelaBlack(`link: https://peritowalker.com.br/${slug}`);
      expect(r.trocados).toHaveLength(0);
      expect(r.texto).toContain(slug);
    }
  });
});

describe("guardas reconhecem a Black", () => {
  test("preço e link da Black contam como oferta", () => {
    expect(temPrecoDePlano("Fica em 12x de R$ 315,38 no cartão.")).toBe(true);
    expect(temPrecoDePlano("em 12x de R$ 157,54")).toBe(true);
    expect(temPrecoDePlano("Fica em 12x de R$ 493 no cartão.")).toBe(true);
    expect(temLinkDePagamento(BLACK_NOVEMBRO.links.anual)).toBe(true);
    expect(temLinkDePagamento(BLACK_NOVEMBRO.links.medicoAnual)).toBe(true);
  });

  test("o pitch da Black conta dois planos (não aciona a trava de cardápio)", () => {
    expect(planosCitados("O Anual com material fica em 12x de R$ 315,38. O Semestral, em 12x de R$ 157,54.")).toEqual(["black_anual_material", "black_semestral"]);
    expect(planosCitados("Fica em 12x de R$ 246,32 no cartão.")).toEqual(["black_anual"]);
  });

  test("parcelado prometido com link da Black escala (não existe parcelado da Black)", () => {
    const r = conferirFormaDePagamento(`Dá pra fazer no boleto parcelado em 12x: ${BLACK_NOVEMBRO.links.anual}`);
    expect(r.semParcelado).toContain("black_anual");
  });
});

describe("blocos do prompt", () => {
  test("perito: narrativa, os três preços com centavos e os links da Black", () => {
    const b = blocoBlackNovembroPerito();
    expect(b).toContain("consegui te encaixar no valor dela");
    for (const v of ["315,38", "246,32", "157,54", BLACK_NOVEMBRO.links.anualMaterial, BLACK_NOVEMBRO.links.semestral]) expect(b).toContain(v);
    expect(b).not.toContain("—");
  });

  test("médico: Anual do legista da Black", () => {
    const b = blocoBlackNovembroMedico();
    expect(b).toContain("12x de R$ 493");
    expect(b).toContain(BLACK_NOVEMBRO.links.medicoAnual);
    expect(b).not.toContain("—");
  });
});
