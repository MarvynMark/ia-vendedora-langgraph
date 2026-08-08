import { describe, test, expect } from "bun:test";
import { montarMensagemNovoAluno, formatarTelefoneBr } from "../../src/lib/alerta-novo-aluno.ts";

describe("formatarTelefoneBr", () => {
  test("converte E.164 brasileiro em formato legível", () => {
    expect(formatarTelefoneBr("+5562999996666")).toBe("(62) 99999-6666");
  });

  test("cobre número de 8 dígitos (sem o 9º)", () => {
    expect(formatarTelefoneBr("+556232221111")).toBe("(62) 3222-1111");
  });

  test("avisa quando não veio telefone", () => {
    expect(formatarTelefoneBr(undefined)).toBe("(não informado)");
  });
});

describe("montarMensagemNovoAluno", () => {
  // Venda pela TMB (boleto parcelado): payload real tem `documento` pontuado e
  // `titulo` = "Perito Criminal - 6 meses"
  test("venda TMB: traz o CPF e marca o plano com o sufixo - TMB", () => {
    const msg = montarMensagemNovoAluno({
      nome: "Fulano de Tal",
      email: "fulano@gmail.com",
      telefone: "+5562999996666",
      cpf: "069.242.814-00",
      plano: "Perito Criminal - 6 meses",
      origem: "tmb",
    });

    expect(msg).toBe(
      "✅✅ NOVO ALUNO MENTORIA: Fulano de Tal\n"
      + "Email: fulano@gmail.com\n"
      + "Telefone: (62) 99999-6666\n"
      + "CPF: 069.242.814-00\n"
      + "Perito Criminal - 6 meses - TMB",
    );
  });

  // Venda pela DMGuru: `contact.doc` vem só com dígitos e o plano NÃO leva sufixo
  test("venda DMGuru: formata o CPF cru e não põe sufixo no plano", () => {
    const msg = montarMensagemNovoAluno({
      nome: "Ciclana Silva",
      email: "ciclana@gmail.com",
      telefone: "+5511988887777",
      cpf: "06924281400",
      plano: "Mentoria Vestigium - Perito Criminal - Anual",
      origem: "dmguru",
    });

    expect(msg).toContain("CPF: 069.242.814-00");
    expect(msg).toEndWith("Mentoria Vestigium - Perito Criminal - Anual");
    expect(msg).not.toContain("TMB");
  });

  test("origem ausente é tratada como DMGuru (sem sufixo)", () => {
    const msg = montarMensagemNovoAluno({ nome: "Beltrano", plano: "Anual" });
    expect(msg).toEndWith("\nAnual");
  });

  test("campos faltando não quebram a mensagem", () => {
    const msg = montarMensagemNovoAluno({ nome: "Beltrano", plano: "Anual", origem: "tmb" });
    expect(msg).toBe(
      "✅✅ NOVO ALUNO MENTORIA: Beltrano\n"
      + "Email: (não informado)\n"
      + "Telefone: (não informado)\n"
      + "CPF: (não informado)\n"
      + "Anual - TMB",
    );
  });

  test("mantém 5 linhas — o time lê o alerta nessa ordem fixa", () => {
    const linhas = montarMensagemNovoAluno({
      nome: "Fulano", email: "a@b.com", telefone: "+5562999996666",
      cpf: "06924281400", plano: "Anual", origem: "tmb",
    }).split("\n");
    expect(linhas).toHaveLength(5);
    expect(linhas[3]).toStartWith("CPF: ");
  });
});
