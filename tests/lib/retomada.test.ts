import { describe, test, expect } from "bun:test";
import { validarRetomarEm, momentoRetomada, linhaRetomada, lerRetomada, removerRetomada, aplicarRetomada, datasReferenciaRetomada } from "../../src/lib/retomada.ts";

// Qui 08/10/2026 15:00 em SP — o dia da conv 9883 ("na próxima semana").
const AGORA = new Date("2026-10-08T18:00:00Z");
const CARD = "🟢 - Concurso: PCDF\n🔁 - Follow-ups: 2\n👤 - Descrição: em negociação";

describe("validarRetomarEm", () => {
  test("data futura → 10:05 de SP no dia", () => {
    const r = validarRetomarEm("2026-10-12", AGORA);
    expect("momento" in r && r.momento.toISOString()).toBe("2026-10-12T13:05:00.000Z");
  });

  test("domingo cai na segunda", () => {
    const r = validarRetomarEm("2026-10-11", AGORA);
    expect("momento" in r && r.momento.toISOString()).toBe("2026-10-12T13:05:00.000Z");
  });

  test("hoje, passado, formato errado e data inexistente são recusados", () => {
    expect("erro" in validarRetomarEm("2026-10-08", AGORA)).toBe(true);
    expect("erro" in validarRetomarEm("2026-10-01", AGORA)).toBe(true);
    expect("erro" in validarRetomarEm("12/10/2026", AGORA)).toBe(true);
    expect("erro" in validarRetomarEm("2026-02-30", AGORA)).toBe(true);
  });

  test("mais de 120 dias é 'não agora', não data", () => {
    expect("erro" in validarRetomarEm("2027-03-01", AGORA)).toBe(true);
  });

  test("23h em SP ainda é o mesmo dia (UTC já virou)", () => {
    const quintaNoite = new Date("2026-10-09T02:30:00Z"); // qui 08/10 23:30 em SP
    expect("erro" in validarRetomarEm("2026-10-09", quintaNoite)).toBe(false);
  });
});

describe("linha do card", () => {
  const linha = linhaRetomada({ ano: 2026, mes: 10, dia: 12 }, "vai decidir na próxima semana");

  test("formato legível com dia da semana", () => {
    expect(linha).toBe("📅 - Retomar em: 12/10/2026 (seg) — vai decidir na próxima semana");
  });

  test("lerRetomada devolve o momento do disparo", () => {
    expect(lerRetomada(`${CARD}\n${linha}`)?.momento.toISOString()).toBe("2026-10-12T13:05:00.000Z");
    expect(lerRetomada(CARD)).toBeNull();
  });

  test("lê linha escrita à mão pela equipe", () => {
    expect(lerRetomada(`${CARD}\nretomar em 20/10/2026`)?.momento.toISOString()).toBe("2026-10-20T13:05:00.000Z");
  });

  test("o 'retomar:' antigo (sem data) não é retomada", () => {
    expect(lerRetomada(`${CARD}\nretomar: vai decidir semana que vem`)).toBeNull();
  });

  test("removerRetomada tira só a linha", () => {
    expect(removerRetomada(`${CARD}\n${linha}`)).toBe(CARD);
  });
});

describe("aplicarRetomada", () => {
  const antiga = linhaRetomada({ ano: 2026, mes: 10, dia: 12 }, "semana que vem");

  test("data nova substitui a antiga (sem duplicar)", () => {
    const r = aplicarRetomada(`${CARD}\n${antiga}`, `${CARD}\n${antiga}`, { dia: { ano: 2026, mes: 11, dia: 2 }, contexto: "mês que vem" });
    expect(r.match(/Retomar em/g)?.length).toBe(1);
    expect(r).toContain("02/11/2026");
  });

  test("LLM reescreveu a descrição sem a linha → a do card é preservada", () => {
    expect(aplicarRetomada(CARD, `${CARD}\n${antiga}`)).toBe(`${CARD}\n${antiga}`);
  });

  test("sem retomada em lugar nenhum → descrição intacta", () => {
    expect(aplicarRetomada(CARD, CARD)).toBe(CARD);
  });
});

describe("datasReferenciaRetomada", () => {
  test("quinta: semana que vem = segunda 12/10, mês que vem = 01/11", () => {
    const ref = datasReferenciaRetomada(AGORA);
    expect(ref).toContain("hoje: 2026-10-08 (qui)");
    expect(ref).toContain('"semana que vem" / "próxima semana": 2026-10-12 (seg)');
    expect(ref).toContain('"mês que vem": 2026-11-01');
  });

  test("numa segunda, 'semana que vem' é a segunda seguinte", () => {
    expect(datasReferenciaRetomada(new Date("2026-10-12T15:00:00Z"))).toContain("2026-10-19 (seg)");
  });

  test("dezembro vira o ano", () => {
    expect(datasReferenciaRetomada(new Date("2026-12-10T15:00:00Z"))).toContain('"mês que vem": 2027-01-01');
  });
});

test("momentoRetomada em dia útil não muda o dia", () => {
  expect(momentoRetomada({ ano: 2026, mes: 10, dia: 13 }).toISOString()).toBe("2026-10-13T13:05:00.000Z");
});
