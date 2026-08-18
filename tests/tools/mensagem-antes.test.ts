import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockEnviarMensagem = mock(async () => ({ id: 1 }));
const mockRegistrarTextoMidia = mock((_c: string | number, _t: string) => {});
const mockRegistrarNaoEnviado = mock((_c: string | number, _t: string) => {});
let saidas: string[] = [];

mock.module("../../src/services/chatwoot.ts", () => ({
  enviarMensagem: mockEnviarMensagem,
  pausaComDigitando: mock(async () => {}),
  calcularDelayDigitando: () => 0,
  registrarTextoMidia: mockRegistrarTextoMidia,
  registrarTextoMidiaNaoEnviado: mockRegistrarNaoEnviado,
  saidasRecentes: () => saidas,
}));

const { enviarMensagemAntes } = await import("../../src/tools/mensagem-antes.ts");

const CONTA = "8";
const CONVERSA = "5525";

// Textos reais da conv 5525: a IA mandou isto como texto normal num turno...
const TEXTO_5525_T1 =
  "Acabei de ver que você é formado em Biomedicina e que sua maior dificuldade tem sido não saber por onde começar ou focar. Isso é bem mais comum do que parece, e quase nunca é falta de esforço";
// ...e repetiu a segunda frase no mensagem_antes do turno seguinte.
const REPETIDA = "Isso é mais comum do que parece, e quase nunca é falta de esforço.";

function textosEnviados(): string[] {
  return mockEnviarMensagem.mock.calls.map(c => (c as unknown as unknown[])[2] as string);
}

beforeEach(() => {
  mockEnviarMensagem.mockClear();
  mockRegistrarTextoMidia.mockClear();
  mockRegistrarNaoEnviado.mockClear();
  saidas = [];
});

describe("enviarMensagemAntes — regressão da conv 5525", () => {
  test("não reenvia a frase que a IA já disse no turno anterior", async () => {
    saidas = [TEXTO_5525_T1];
    await enviarMensagemAntes(CONTA, CONVERSA, REPETIDA, "teste");
    expect(mockEnviarMensagem).not.toHaveBeenCalled();
  });

  test("mesmo sem enviar nada, registra o texto no filtro de saída", async () => {
    saidas = [TEXTO_5525_T1];
    await enviarMensagemAntes(CONTA, CONVERSA, REPETIDA, "teste");
    expect(mockRegistrarNaoEnviado).toHaveBeenCalledTimes(1);
    // ...mas NÃO no histórico, senão gravaríamos mensagem que o lead nunca viu
    expect(mockRegistrarTextoMidia).not.toHaveBeenCalled();
  });
});

describe("enviarMensagemAntes — filtro parcial", () => {
  test("envia só a frase nova quando parte já foi dita", async () => {
    saidas = [TEXTO_5525_T1];
    await enviarMensagemAntes(
      CONTA,
      CONVERSA,
      `${REPETIDA} Dá uma olhada no que eu tenho pra te dizer.`,
      "teste",
    );
    expect(textosEnviados()).toEqual(["Dá uma olhada no que eu tenho pra te dizer."]);
  });

  test("histórico recebe só o que foi enviado; filtro recebe o texto inteiro", async () => {
    saidas = [TEXTO_5525_T1];
    const inteiro = `${REPETIDA} Dá uma olhada no que eu tenho pra te dizer.`;
    await enviarMensagemAntes(CONTA, CONVERSA, inteiro, "teste");
    expect(mockRegistrarTextoMidia.mock.calls[0]![1]).toBe(
      "Dá uma olhada no que eu tenho pra te dizer.",
    );
    expect(mockRegistrarNaoEnviado.mock.calls[0]![1]).toBe(inteiro);
  });
});

describe("enviarMensagemAntes — caminho normal preservado", () => {
  test("sem histórico, envia todas as frases", async () => {
    await enviarMensagemAntes(CONTA, CONVERSA, REPETIDA, "teste");
    expect(textosEnviados()).toEqual([REPETIDA]);
  });

  test("histórico não relacionado não filtra nada", async () => {
    saidas = ["Oi, Luiz! Aqui é o Perito Walker.", "Posso te mostrar os planos?"];
    await enviarMensagemAntes(CONTA, CONVERSA, REPETIDA, "teste");
    expect(textosEnviados()).toEqual([REPETIDA]);
  });

  test("cada frase vira uma mensagem separada", async () => {
    await enviarMensagemAntes(CONTA, CONVERSA, "Primeira frase. Segunda frase.", "teste");
    expect(textosEnviados()).toEqual(["Primeira frase.", "Segunda frase."]);
  });

  test("mensagem_antes vazio/ausente não envia nada", async () => {
    await enviarMensagemAntes(CONTA, CONVERSA, undefined, "teste");
    await enviarMensagemAntes(CONTA, CONVERSA, "   ", "teste");
    expect(mockEnviarMensagem).not.toHaveBeenCalled();
  });
});

describe("enviarMensagemAntes — robustez", () => {
  test("erro no envio não propaga (a mídia ainda precisa sair)", async () => {
    mockEnviarMensagem.mockImplementationOnce(async () => {
      throw new Error("chatwoot fora do ar");
    });
    await expect(enviarMensagemAntes(CONTA, CONVERSA, REPETIDA, "teste")).resolves.toBeUndefined();
  });
});
