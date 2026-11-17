import { describe, test, expect } from "bun:test";
import { escolherConversaDoFunil, escolherContatoDoPagamento, temCardDeRenovacao } from "../../src/lib/card-funil.ts";

const FUNIL = 1;
const RENOVACAO = 14;

describe("escolherConversaDoFunil", () => {
  test("ignora o card do quadro de renovação e pega o do funil (caso Renata, 07/11)", () => {
    const conversas = [
      { id: 8558, inbox_id: 13, kanban_task: { id: 9410, board_id: RENOVACAO } },
      { id: 2587, inbox_id: 11, kanban_task: { id: 1950, board_id: FUNIL } },
    ];
    expect(escolherConversaDoFunil(conversas, FUNIL)?.id).toBe(2587);
  });

  test("só card de renovação → undefined, para o chamador cair no fallback (caso Priscila, 08/11)", () => {
    const conversas = [
      { id: 11647, inbox_id: 11 },
      { id: 4294, inbox_id: 15, kanban_task: { id: 9111, board_id: RENOVACAO } },
    ];
    expect(escolherConversaDoFunil(conversas, FUNIL)).toBeUndefined();
  });

  test("respeita a ordem: a primeira conversa com card do funil vence", () => {
    const conversas = [
      { id: 3, inbox_id: 11, kanban_task: { id: 30, board_id: FUNIL } },
      { id: 2, inbox_id: 11, kanban_task: { id: 20, board_id: FUNIL } },
    ];
    expect(escolherConversaDoFunil(conversas, FUNIL)?.id).toBe(3);
  });

  test("kanban_task vazio não conta", () => {
    expect(escolherConversaDoFunil([{ id: 1, inbox_id: 11, kanban_task: {} }], FUNIL)).toBeUndefined();
  });
});

describe("temCardDeRenovacao", () => {
  test("card antigo no funil + card no quadro de renovação → já é aluna (caso Leandra, 08/11)", () => {
    const conversas = [
      { id: 4549, inbox_id: 11, kanban_task: { id: 3682, board_id: FUNIL } },
      { id: 10106, inbox_id: 15, kanban_task: { id: 9650, board_id: RENOVACAO } },
    ];
    expect(temCardDeRenovacao(conversas, RENOVACAO)).toBe(true);
  });

  test("só card de renovação, sem funil → já é aluna (caso Eliza, 08/11)", () => {
    const conversas = [
      { id: 11931, inbox_id: 11 },
      { id: 9454, inbox_id: 13, kanban_task: { id: 8772, board_id: RENOVACAO } },
    ];
    expect(temCardDeRenovacao(conversas, RENOVACAO)).toBe(true);
  });

  test("só card do funil → não é renovação por este critério", () => {
    expect(temCardDeRenovacao([{ id: 1, inbox_id: 11, kanban_task: { id: 1, board_id: FUNIL } }], RENOVACAO)).toBe(false);
  });
});

describe("escolherContatoDoPagamento", () => {
  test("contato duplicado sem conversa perde para o que tem card no funil (caso Léia, 16/11)", () => {
    const candidatos = [
      { contato: { id: 57936 }, conversas: [] },
      {
        contato: { id: 56600 },
        conversas: [
          { id: 17447, inbox_id: 13 },
          { id: 10417, inbox_id: 11, kanban_task: { id: 7945, board_id: FUNIL } },
        ],
      },
    ];
    expect(escolherContatoDoPagamento(candidatos, FUNIL)?.contato.id).toBe(56600);
  });

  test("sem card em ninguém, prefere quem tem alguma conversa", () => {
    const candidatos = [
      { contato: { id: 1 }, conversas: [] },
      { contato: { id: 2 }, conversas: [{ id: 9, inbox_id: 11 }] },
    ];
    expect(escolherContatoDoPagamento(candidatos, FUNIL)?.contato.id).toBe(2);
  });

  test("card só no quadro de renovação não conta como card do funil", () => {
    const candidatos = [
      { contato: { id: 1 }, conversas: [{ id: 5, inbox_id: 15, kanban_task: { id: 3, board_id: RENOVACAO } }] },
      { contato: { id: 2 }, conversas: [{ id: 6, inbox_id: 11, kanban_task: { id: 4, board_id: FUNIL } }] },
    ];
    expect(escolherContatoDoPagamento(candidatos, FUNIL)?.contato.id).toBe(2);
  });

  test("um só contato, sem nada: devolve ele (vai para o fallback que cria conversa + card)", () => {
    expect(escolherContatoDoPagamento([{ contato: { id: 7 }, conversas: [] }], FUNIL)?.contato.id).toBe(7);
  });

  test("lista vazia → undefined", () => {
    expect(escolherContatoDoPagamento([], FUNIL)).toBeUndefined();
  });
});
