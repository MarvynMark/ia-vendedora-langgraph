import { describe, test, expect } from "bun:test";
import { codigoDoHorario, lerCodigoDoHorario, instanteDeParedeSP, rotularHora } from "../../src/config/agenda.ts";

// Segunda, 14/09/2026, 14h em SP = 17h UTC.
const SEG_14H = instanteDeParedeSP(2026, 8, 14, 14, 0);

describe("código do horário (hora de parede)", () => {
  test("escreve em hora de Brasília, não em UTC", () => {
    expect(codigoDoHorario(SEG_14H)).toBe("2026-09-14 14:00");
  });

  test("faz a volta sem perder nada", () => {
    expect(lerCodigoDoHorario(codigoDoHorario(SEG_14H))!.getTime()).toBe(SEG_14H.getTime());
  });

  test("aceita 'T' e segundos, que o modelo às vezes acrescenta", () => {
    expect(lerCodigoDoHorario("2026-09-14T14:00")!.getTime()).toBe(SEG_14H.getTime());
    expect(lerCodigoDoHorario("2026-09-14 14:00:00")!.getTime()).toBe(SEG_14H.getTime());
  });

  // O bug de 11/09 (conv 7436 e 7261): o modelo devolveu a hora local com "Z". Isso agora é
  // recusado em vez de virar 11h silenciosamente.
  test("recusa ISO com Z — era exatamente onde o modelo errava", () => {
    expect(lerCodigoDoHorario("2026-09-14T14:00:00.000Z")).toBeNull();
    expect(lerCodigoDoHorario("2026-09-14T17:00:00.000Z")).toBeNull();
  });

  test("recusa offset explícito e lixo", () => {
    expect(lerCodigoDoHorario("2026-09-14T14:00:00-03:00")).toBeNull();
    expect(lerCodigoDoHorario("segunda às 14h")).toBeNull();
    expect(lerCodigoDoHorario("")).toBeNull();
  });

  test("a hora que a ferramenta devolve ao modelo é a mesma do código", () => {
    expect(rotularHora(lerCodigoDoHorario("2026-09-14 19:00")!)).toBe("19h");
  });
});
