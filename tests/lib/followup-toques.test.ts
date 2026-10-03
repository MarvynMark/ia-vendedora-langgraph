import { describe, test, expect } from "bun:test";
import { validarToque, escolherToque2, agendarProximoToque, tirarNomeDoInicio, VARIACOES_TOQUE_2 } from "../../src/lib/followup-toques.ts";

const HORA = 3_600_000;

describe("validarToque — o que a IA escreveu pode ir pro lead?", () => {
  test("pergunta curta ligada à conversa passa, sem as aspas", () => {
    expect(validarToque('"Você vai fazer só a PCDF ou pretende prestar outros de perito também?"'))
      .toBe("Você vai fazer só a PCDF ou pretende prestar outros de perito também?");
  });

  test("sem pergunta, longa demais ou vazia → fallback", () => {
    expect(validarToque("Fico no aguardo do seu retorno.")).toBeNull();
    expect(validarToque(`${"a".repeat(181)}?`)).toBeNull();
    expect(validarToque("")).toBeNull();
  });

  test("preço, link, travessão ou marcador esquecido → fallback", () => {
    expect(validarToque("Ficou pesado o 12x de R$ 197?")).toBeNull();
    expect(validarToque("Conseguiu abrir https://peritowalker.com.br/mentoriaperito?")).toBeNull();
    expect(validarToque("E aí — conseguiu pensar?")).toBeNull();
    expect(validarToque("[Nome], conseguiu pensar?")).toBeNull();
  });

  test("frases banidas do roteiro → fallback", () => {
    expect(validarToque("Faz sentido pra você?")).toBeNull();
    expect(validarToque("O que achou dos planos?")).toBeNull();
    expect(validarToque("Quer garantir sua vaga hoje?")).toBeNull();
  });
});

describe("escolherToque2", () => {
  test("é estável por conversa e sempre uma das variações", () => {
    expect(escolherToque2(9280)).toBe(escolherToque2("9280"));
    for (const id of [1, 2, 3, 9280, 9404]) expect(VARIACOES_TOQUE_2).toContain(escolherToque2(id) as never);
  });
});

describe("agendarProximoToque — toques 1 e 2 na janela grátis, 3 no dia seguinte, encerramento +2 dias", () => {
  // Quarta 15/07/2026, 13:00 SP (16:00 UTC). O lead falou às 10:00 SP → janela fecha amanhã 10:00.
  const agora = new Date(Date.UTC(2026, 6, 15, 16, 0, 0));
  const restante = 21 * HORA;

  test("depois do toque 1, o toque 2 ainda cai DENTRO da janela", () => {
    const t2 = agendarProximoToque(0, restante, agora);
    expect(t2.getTime()).toBeLessThan(agora.getTime() + restante);
    expect(t2.getTime()).toBeGreaterThanOrEqual(agora.getTime() + HORA);
  });

  test("depois do toque 2, o toque 3 sai ~1 dia depois (fora da janela)", () => {
    const t3 = agendarProximoToque(1, 0, agora);
    expect(t3.getTime() - agora.getTime()).toBeGreaterThanOrEqual(24 * HORA);
  });

  test("depois do toque 3, o encerramento sai ~2 dias depois", () => {
    const t4 = agendarProximoToque(2, 0, agora);
    expect(t4.getTime() - agora.getTime()).toBeGreaterThanOrEqual(48 * HORA);
  });
});

describe("agendarProximoToque com 3 toques na janela (pergunta da IA + curiosidade)", () => {
  const agora = new Date(Date.UTC(2026, 6, 15, 16, 0, 0));
  const restante = 21 * HORA;
  const fecha = agora.getTime() + restante;

  test("o áudio cai no meio da janela e o PIX ainda antes de ela fechar", () => {
    const t2 = agendarProximoToque(0, restante, agora, 3);
    expect(t2.getTime()).toBeGreaterThanOrEqual(agora.getTime() + HORA);
    expect(t2.getTime()).toBeLessThan(fecha - HORA);
    const t3 = agendarProximoToque(1, fecha - t2.getTime(), t2, 3);
    expect(t3.getTime()).toBeGreaterThan(t2.getTime());
    expect(t3.getTime()).toBeLessThan(fecha);
  });

  test("depois do PIX, o template sai ~1 dia depois e o encerramento ~2 dias", () => {
    expect(agendarProximoToque(2, 0, agora, 3).getTime() - agora.getTime()).toBeGreaterThanOrEqual(24 * HORA);
    expect(agendarProximoToque(3, 0, agora, 3).getTime() - agora.getTime()).toBeGreaterThanOrEqual(48 * HORA);
  });
});

describe("tirarNomeDoInicio — mensagem que abre com o nome é cara de disparo", () => {
  test("tira o nome (e o oi) do começo e recapitaliza", () => {
    expect(tirarNomeDoInicio("Lucas, qual matéria você precisa focar?", "Lucas")).toBe("Qual matéria você precisa focar?");
    expect(tirarNomeDoInicio("Oi Lucas, conseguiu ver?", "Lucas")).toBe("Conseguiu ver?");
    expect(tirarNomeDoInicio("Miriã, conseguiu pagar?", "Miriã")).toBe("Conseguiu pagar?");
  });

  test("nome no meio ou no fim fica, e palavra que só começa igual não é o nome", () => {
    expect(tirarNomeDoInicio("Você vai fazer só a PCDF, Lucas?", "Lucas")).toBe("Você vai fazer só a PCDF, Lucas?");
    expect(tirarNomeDoInicio("Lucasinho é seu apelido?", "Lucas")).toBe("Lucasinho é seu apelido?");
  });
});
