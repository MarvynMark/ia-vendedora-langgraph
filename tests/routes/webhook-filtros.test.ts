import { describe, test, expect } from "bun:test";
import { pedeGrupoDeEspera } from "../../src/routes/webhook-filtros.ts";

// Conv 6890: a lead contou que tinha visto um vídeo "que você mandou no grupo de espera" e recebeu,
// um segundo depois, o convite pra entrar no grupo — onde ela já estava, e acabara de provar.
describe("pedeGrupoDeEspera", () => {
  test("MENÇÃO ao grupo não é pedido", () => {
    expect(pedeGrupoDeEspera(
      "Ontem eu assisti o vídeo no YouTube - papo com o aprovado. Que você mandou no grupo de espera. Foi muito inspiradora a história da Fernanda",
    )).toBe(false);
    expect(pedeGrupoDeEspera("vi lá no grupo de espera que teve uma live")).toBe(false);
    expect(pedeGrupoDeEspera("o pessoal falou no grupo de espera sobre o edital")).toBe(false);
  });

  test("PEDIDO continua disparando", () => {
    expect(pedeGrupoDeEspera("grupo de espera")).toBe(true);
    expect(pedeGrupoDeEspera("quero entrar no grupo")).toBe(true);
    expect(pedeGrupoDeEspera("Como faço pra entrar no grupo de espera?")).toBe(true);
    expect(pedeGrupoDeEspera("me manda o link do grupo de espera por favor")).toBe(true);
    expect(pedeGrupoDeEspera("gostaria de ter acesso ao grupo")).toBe(true);
  });

  test("menção + pedido na mesma frase é pedido", () => {
    expect(pedeGrupoDeEspera("vi que tem um grupo de espera, quero entrar")).toBe(true);
    expect(pedeGrupoDeEspera("me falaram do grupo de espera, pode me mandar o link?")).toBe(true);
  });

  test("sem a expressão, nunca dispara", () => {
    expect(pedeGrupoDeEspera("quero entrar na mentoria")).toBe(false);
    expect(pedeGrupoDeEspera("")).toBe(false);
    expect(pedeGrupoDeEspera("bom dia")).toBe(false);
  });
});
