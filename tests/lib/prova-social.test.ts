import { describe, test, expect } from "bun:test";
import { escolherCaso, CASOS_APROVADOS } from "../../src/lib/prova-social.ts";

describe("escolherCaso — print de aprovado da mesma graduação do lead", () => {
  test("casa a graduação do formulário, com ou sem acento", () => {
    expect(escolherCaso("Medicina Veterinária")?.id).toBe("beatriz-fernanda-medvet");
    expect(escolherCaso("med vet")?.id).toBe("beatriz-fernanda-medvet");
    expect(escolherCaso("Farmacia")?.id).toBe("najla-farmacia");
    expect(escolherCaso("Ciência da Computação")?.id).toBe("gusthavo-computacao");
    expect(escolherCaso("Análise e Desenvolvimento de Sistemas")?.id).toBe("gusthavo-computacao");
    expect(escolherCaso("Licenciatura em Química")?.id).toBe("pedro-quimica");
  });

  test("medicina alterna entre Vítor e Natália, sempre o mesmo pra mesma conversa", () => {
    const ids = new Set([1, 2, 3, 4].map((c) => escolherCaso("Médico Formado", c)?.id));
    expect(ids).toEqual(new Set(["vitor-medicina", "natalia-medicina"]));
    expect(escolherCaso("Medicina", 9404)?.id).toBe(escolherCaso("Medicina", "9404")?.id);
  });

  test("biomedicina não é medicina, e veterinária não cai no médico", () => {
    expect(escolherCaso("Biomedicina")?.formacao.source).toBe(".");
    expect(escolherCaso("Medicina Veterinária", 1)?.id).toBe("beatriz-fernanda-medvet");
  });

  test("graduação sem caso próprio ou desconhecida recebe os DOIS prints gerais (legenda sem formação)", () => {
    for (const f of ["Direito", "Biologia", null, ""]) {
      const caso = escolherCaso(f, 7)!;
      expect(caso.id).toBe("thaynara-rafael-geral");
      expect(caso.urls).toHaveLength(2);
      expect(caso.legenda).not.toContain("como você");
    }
  });

  test("todo print vem do MinIO, nunca do repositório (o repo é público)", () => {
    for (const c of CASOS_APROVADOS) {
      expect(c.urls.length).toBeGreaterThan(0);
      for (const u of c.urls) expect(u).toMatch(/^https:\/\/s3\.stkd\.site\/arquivosclientes\/Vestigium\/prova-social\/[a-z-]+\.jpg$/);
    }
  });
});
