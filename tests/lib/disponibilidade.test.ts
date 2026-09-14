import { describe, test, expect } from "bun:test";
import { slotsLivres, quemAtende, slotColide, type AgendaAtendente } from "../../src/lib/disponibilidade.ts";
import { instanteDeParedeSP, rotularHora, rotularDia } from "../../src/config/agenda.ts";

// Quarta-feira, 16/09/2026, 08h00 em SP. Dia útil, antes do expediente.
const AGORA = instanteDeParedeSP(2026, 8, 16, 8, 0);
const sp = (dia: number, hora: number) => instanteDeParedeSP(2026, 8, dia, hora, 0);
const evento = (dia: number, hora: number) => ({ inicio: sp(dia, hora), fim: sp(dia, hora + 1) });

const vazias = (): AgendaAtendente[] => [
  { nome: "Gusthavo", calendarId: "cal-g", ocupados: [] },
  { nome: "Pedro", calendarId: "cal-p", ocupados: [] },
];

describe("slotsLivres", () => {
  test("oferece DOIS horários, ambos no dia mais próximo (latência mata momentum)", () => {
    const s = slotsLivres(vazias(), { agora: AGORA });
    expect(s).toHaveLength(2);
    expect(rotularDia(s[0]!.inicio)).toBe(rotularDia(s[1]!.inicio));
    // 08h + 90 min de antecedência: o 9h fica de fora, começa no 10h.
    expect(rotularHora(s[0]!.inicio)).toBe("10h");
    expect(rotularHora(s[1]!.inicio)).toBe("11h");
  });

  test("só pula para o dia seguinte quando o dia mais próximo não tem duas vagas no período", () => {
    // Quarta 16/09: tarde toda tomada nas duas agendas, menos as 17h.
    const ocupadaMenos17h = [13, 14, 15, 16].map((h) => evento(16, h));
    const agendas: AgendaAtendente[] = [
      { nome: "Gusthavo", calendarId: "cal-g", ocupados: ocupadaMenos17h },
      { nome: "Pedro", calendarId: "cal-p", ocupados: ocupadaMenos17h },
    ];
    const s = slotsLivres(agendas, { agora: AGORA, preferencia: "tarde" });
    expect(s).toHaveLength(2);
    expect(rotularDia(s[0]!.inicio)).toContain("16/09");
    expect(rotularHora(s[0]!.inicio)).toBe("17h");
    expect(rotularDia(s[1]!.inicio)).toContain("17/09");
  });

  test("com umPorDia ligado, volta a oferecer dias diferentes", () => {
    const s = slotsLivres(vazias(), { agora: AGORA, umPorDia: true });
    expect(rotularDia(s[0]!.inicio)).not.toBe(rotularDia(s[1]!.inicio));
  });

  test("respeita a antecedência de 90 min — não oferece daqui a pouco", () => {
    // 08h50: o slot das 9h está a 10 minutos, perto demais.
    const s = slotsLivres(vazias(), { agora: instanteDeParedeSP(2026, 8, 16, 8, 50) });
    expect(rotularHora(s[0]!.inicio)).not.toBe("9h");
  });

  test("mas oferece NO MESMO DIA quando dá tempo (latência mata momentum)", () => {
    const s = slotsLivres(vazias(), { agora: AGORA });
    expect(rotularDia(s[0]!.inicio)).toContain("16/09");
  });

  test("filtra por período: noite só devolve 18h ou mais", () => {
    for (const s of slotsLivres(vazias(), { agora: AGORA, preferencia: "noite", limite: 5 })) {
      expect(Number(rotularHora(s.inicio).replace("h", ""))).toBeGreaterThanOrEqual(18);
    }
  });

  test("nunca oferece 12h — é o almoço", () => {
    const todos = slotsLivres(vazias(), { agora: AGORA, limite: 60, umPorDia: false });
    expect(todos.map((s) => rotularHora(s.inicio))).not.toContain("12h");
  });

  test("não oferece fim de semana", () => {
    // sexta 19/09 08h → os próximos dias são sáb/dom, que não têm grade
    const s = slotsLivres(vazias(), { agora: instanteDeParedeSP(2026, 8, 19, 22, 0), limite: 2 });
    for (const x of s) expect(rotularDia(x.inicio)).toMatch(/segunda|terça/);
  });

  test("horário ocupado nas DUAS agendas some da oferta", () => {
    const cheias: AgendaAtendente[] = [
      { nome: "Gusthavo", calendarId: "cal-g", ocupados: [evento(16, 9)] },
      { nome: "Pedro", calendarId: "cal-p", ocupados: [evento(16, 9)] },
    ];
    const s = slotsLivres(cheias, { agora: AGORA, limite: 10, umPorDia: false });
    const noDia16 = s.filter((x) => rotularDia(x.inicio).includes("16/09"));
    expect(noDia16.map((x) => rotularHora(x.inicio))).not.toContain("9h");
  });

  test("ocupado em UMA agenda: o horário continua, com o outro atendente", () => {
    const meio: AgendaAtendente[] = [
      { nome: "Gusthavo", calendarId: "cal-g", ocupados: [evento(16, 9)] },
      { nome: "Pedro", calendarId: "cal-p", ocupados: [] },
    ];
    // Às 07h o slot das 9h já respeita a antecedência de 90 min.
    const s = slotsLivres(meio, { agora: instanteDeParedeSP(2026, 8, 16, 7, 0), limite: 1 });
    expect(rotularHora(s[0]!.inicio)).toBe("9h");
    expect(s[0]!.nome).toBe("Pedro");
  });

  test("balanceia: quem tem menos sessão no dia leva a próxima", () => {
    const desbalanceadas: AgendaAtendente[] = [
      { nome: "Gusthavo", calendarId: "cal-g", ocupados: [evento(16, 9), evento(16, 10)] },
      { nome: "Pedro", calendarId: "cal-p", ocupados: [] },
    ];
    expect(slotsLivres(desbalanceadas, { agora: AGORA, limite: 1 })[0]!.nome).toBe("Pedro");
  });

  test("agenda lotada devolve MENOS que o limite, não inventa", () => {
    const lotadas = vazias().map((a) => ({
      ...a,
      ocupados: Array.from({ length: 12 }, (_, h) => evento(16, 9 + h)),
    }));
    const s = slotsLivres(lotadas, { agora: AGORA, diasAFrente: 0, limite: 2 });
    expect(s.length).toBeLessThan(2);
  });
});

describe("quemAtende — guarda de corrida antes de criar o evento", () => {
  test("devolve o atendente quando o horário ainda está livre", () => {
    expect(quemAtende(sp(16, 14), vazias(), AGORA)?.calendarId).toBeTruthy();
  });

  test("null quando os dois ficaram ocupados entre a oferta e a resposta", () => {
    const cheias: AgendaAtendente[] = [
      { nome: "Gusthavo", calendarId: "cal-g", ocupados: [evento(16, 14)] },
      { nome: "Pedro", calendarId: "cal-p", ocupados: [evento(16, 14)] },
    ];
    expect(quemAtende(sp(16, 14), cheias, AGORA)).toBeNull();
  });

  test("null para horário fora da grade (12h, madrugada, fim de semana)", () => {
    expect(quemAtende(sp(16, 12), vazias(), AGORA)).toBeNull();
    expect(quemAtende(sp(16, 3), vazias(), AGORA)).toBeNull();
    expect(quemAtende(sp(19 + 1, 14), vazias(), AGORA)).toBeNull(); // sábado 20/09
  });

  test("null para horário no passado", () => {
    expect(quemAtende(sp(16, 9), vazias(), instanteDeParedeSP(2026, 8, 16, 18, 0))).toBeNull();
  });
});

describe("slotColide", () => {
  test("sobreposição parcial conta como colisão", () => {
    expect(slotColide(sp(16, 9), [{ inicio: sp(16, 9), fim: sp(16, 10) }])).toBe(true);
    expect(slotColide(sp(16, 9), [{ inicio: sp(16, 10), fim: sp(16, 11) }])).toBe(false);
  });
});

describe("distribuição entre os dois closers", () => {
  test("agendas vazias não jogam tudo para o primeiro da lista", () => {
    // Regressão: com desempate só por dia, duas agendas vazias empatavam sempre e a ordem da
    // lista dava TODOS os primeiros horários de TODOS os dias para o Gusthavo.
    const g = { nome: "Gusthavo", calendarId: "cal-g", ocupados: [evento(16, 9)] };
    const p = { nome: "Pedro", calendarId: "cal-p", ocupados: [] as ReturnType<typeof evento>[] };
    // Gusthavo tem 1 no dia 16; no dia 17 os dois estão zerados NAQUELE dia, mas ele tem 1 no total.
    expect(slotsLivres([g, p], { agora: sp(17, 7), limite: 1 })[0]!.nome).toBe("Pedro");
  });

  test("carga do DIA continua vencendo a carga total", () => {
    const g = { nome: "Gusthavo", calendarId: "cal-g", ocupados: [] as ReturnType<typeof evento>[] };
    const p = { nome: "Pedro", calendarId: "cal-p", ocupados: [evento(17, 9), evento(17, 10)] };
    // Pedro tem menos no total? não — tem mais. E tem 2 no dia 17. Gusthavo leva.
    expect(slotsLivres([g, p], { agora: sp(17, 7), limite: 1 })[0]!.nome).toBe("Gusthavo");
  });
});
