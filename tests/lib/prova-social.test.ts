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
    expect(escolherCaso("Biomedicina")?.id.startsWith("geral-")).toBe(true);
    expect(escolherCaso("Medicina Veterinária", 1)?.id).toBe("beatriz-fernanda-medvet");
  });

  test("sem caso da área: dois alunos distintos, sem graduação na legenda e sem médico", () => {
    const vistos = new Set<string>();
    for (const f of ["Direito", "Biologia", null, ""]) {
      for (let c = 0; c < 40; c++) {
        const caso = escolherCaso(f, c)!;
        expect(caso.id.startsWith("geral-")).toBe(true);
        expect(caso.urls).toHaveLength(2);
        expect(new Set(caso.urls).size).toBe(2);
        expect(caso.legenda).not.toMatch(/como você|veterin|farmac|comput|quimic|medic|legista/i);
        expect(caso.urls.join(" ")).not.toMatch(/medicina|natalia/);
        vistos.add(caso.id);
      }
    }
    expect(vistos.size).toBeGreaterThan(5); // varia de verdade entre conversas
  });

  test("a mesma conversa recebe sempre a mesma dupla", () => {
    expect(escolherCaso("Direito", 9360)?.id).toBe(escolherCaso("Biologia", "9360")?.id);
  });

  test("todo print vem do MinIO, nunca do repositório (o repo é público)", () => {
    for (const c of CASOS_APROVADOS) {
      expect(c.urls.length).toBeGreaterThan(0);
      for (const u of c.urls) expect(u).toMatch(/^https:\/\/s3\.stkd\.site\/arquivosclientes\/Vestigium\/prova-social\/[a-z-]+\.jpg$/);
    }
  });
});
