import { describe, test, expect } from "bun:test";
import { escolherConversaDoFunil } from "../../src/lib/card-funil.ts";

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
