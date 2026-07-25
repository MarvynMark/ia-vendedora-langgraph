import { describe, test, expect } from "bun:test";
import { classificar } from "../../src/graphs/follow-up/graph.ts";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

// tipoFollowup vazio força a classificação PELO step (senão classificar retorna o pré-definido).
function state(stepName: string, description = ""): FollowUpStateType {
  return {
    messages: [], accountId: 8, boardId: 1, taskId: 1,
    board_step: { id: 1, name: stepName },
    title: "Test", description, dueDate: "", telefone: "+5511999999999",
    conversationId: 100, inboxId: 1, displayId: 1,
    funilSteps: [], idEtapaPerdido: 0,
    tipoFollowup: "" as unknown as FollowUpStateType["tipoFollowup"],
    respostaAgente: "",
  };
}

// "Aguardando Pagamento" tem duas subpopulações: quem viu o preço e sumiu (proposta_apresentada,
// sem link) deve entrar na sequência PÓS-PREÇO (via agente_followup); quem já recebeu o link
// segue no lembrete de pagamento. Antes, todos caíam no lembrete ("o link ainda tá ativo").
describe("classificar — Aguardando Pagamento (pós-preço vs lembrete)", () => {
  test("proposta_apresentada SEM link → followup (sequência pós-preço)", async () => {
    const r = await classificar(state("Aguardando Pagamento", "🟢 Concurso: PCDF\nstatus: proposta_apresentada"));
    expect(r.tipoFollowup).toBe("followup");
  });

  test("link enviado → lembrete", async () => {
    const r = await classificar(state("Aguardando Pagamento", "🟢 Concurso: PCDF\nstatus: link enviado"));
    expect(r.tipoFollowup).toBe("lembrete");
  });

  test("proposta_apresentada E link enviado → lembrete (o link vence)", async () => {
    const r = await classificar(state("Aguardando Pagamento", "status: proposta_apresentada\nstatus: link enviado"));
    expect(r.tipoFollowup).toBe("lembrete");
  });

  test("sem status na descrição → lembrete (comportamento padrão)", async () => {
    const r = await classificar(state("Aguardando Pagamento", "🟢 Concurso: PCDF"));
    expect(r.tipoFollowup).toBe("lembrete");
  });

  test("Conexão → followup; Ganho → boas_vindas (regressão dos demais steps)", async () => {
    expect((await classificar(state("Conexão"))).tipoFollowup).toBe("followup");
    expect((await classificar(state("Ganho"))).tipoFollowup).toBe("boas_vindas");
  });
});
