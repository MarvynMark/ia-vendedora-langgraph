import { describe, test, expect } from "bun:test";
import { pedeGrupoDeEspera, mensagemGrupoDeEspera, mensagemEhDeMedico, respostaConfirmacaoEvento, CONVITES_EVENTO } from "../../src/routes/webhook-filtros.ts";

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

describe("grupo de espera: médicos vs geral", () => {
  const links = { geral: "https://chat.whatsapp.com/GERAL", medicos: "https://chat.whatsapp.com/MEDICOS" };

  test("médico recebe o link de médicos; os demais, o geral", () => {
    expect(mensagemGrupoDeEspera(true, links)).toContain(links.medicos);
    expect(mensagemGrupoDeEspera(true, links)).not.toContain(links.geral);
    expect(mensagemGrupoDeEspera(false, links)).toContain(links.geral);
    expect(mensagemGrupoDeEspera(false, links)).not.toContain(links.medicos);
  });

  test("as duas mensagens contêm 'grupo de espera' (dedup de 10min depende disso)", () => {
    expect(mensagemGrupoDeEspera(true, links)).toContain("grupo de espera");
    expect(mensagemGrupoDeEspera(false, links)).toContain("grupo de espera");
  });

  test("mensagem que se identifica como de médico", () => {
    expect(mensagemEhDeMedico("Quero entrar no grupo de espera dos médicos")).toBe(true);
    expect(mensagemEhDeMedico("sou médica, quero entrar no grupo")).toBe(true);
    expect(mensagemEhDeMedico("quero ser medico legista, grupo de espera")).toBe(true);
  });

  test("perito, biomédico e veterinário não contam como médico", () => {
    expect(mensagemEhDeMedico("quero entrar no grupo de espera")).toBe(false);
    expect(mensagemEhDeMedico("estudo medicina legal, quero entrar no grupo")).toBe(false);
    expect(mensagemEhDeMedico("sou biomédico, quero entrar no grupo")).toBe(false);
    expect(mensagemEhDeMedico("sou médico veterinário, quero entrar no grupo")).toBe(false);
  });
});

describe("respostaConfirmacaoEvento", () => {
  const agora = 2_000_000_000;
  const convite = { message_type: 1, content: "AVISO IMPORTANTE", created_at: agora - 3600, additional_attributes: { template_params: { name: "encontro_legista_2110" } } };

  test("Confirmar depois do convite devolve o link", () => {
    const r = respostaConfirmacaoEvento(" confirmar ", [convite], agora);
    expect(r).toContain("https://www.youtube.com/watch?v=yyRL-WCCrG0");
  });

  test("outra mensagem, ou Confirmar sem convite, não dispara", () => {
    expect(respostaConfirmacaoEvento("Confirmar presença amanhã", [convite], agora)).toBeNull();
    expect(respostaConfirmacaoEvento("Confirmar", [{ ...convite, additional_attributes: { template_params: { name: "encontro_pcmg_2110" } } }], agora)).toBeNull();
    expect(respostaConfirmacaoEvento("Confirmar", [{ message_type: 1, content: "oi", created_at: agora }], agora)).toBeNull();
  });

  test("responde uma vez só e não responde convite velho", () => {
    const link = { message_type: 1, content: CONVITES_EVENTO.encontro_legista_2110!, created_at: agora - 60 };
    expect(respostaConfirmacaoEvento("Confirmar", [convite, link], agora)).toBeNull();
    expect(respostaConfirmacaoEvento("Confirmar", [{ ...convite, created_at: agora - 5 * 86_400 }], agora)).toBeNull();
  });
});
