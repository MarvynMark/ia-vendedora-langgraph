import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock do env para controlar a validação por header (Chave/Valor da TMB)
mock.module("../../src/config/env.ts", () => ({
  env: {
    TMB_WEBHOOK_HEADER: "x-tmb-token",
    TMB_WEBHOOK_SECRET: "s3cr3t",
  },
}));

// Stub da lógica compartilhada — não queremos tocar no Chatwoot durante o teste.
// Capturamos os argumentos para validar o mapeamento do payload da TMB.
const processarMock = mock(async (_dados: unknown) => {});
mock.module("../../src/routes/pagamento.ts", () => ({
  processarPagamentoAprovado: processarMock,
}));

import { pagamentoTmbRouter } from "../../src/routes/pagamento-tmb.ts";

function makeRequest(body: object, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/webhook/pagamento-tmb", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tmb-token": "s3cr3t", ...headers },
    body: JSON.stringify(body),
  });
}

// Payload real do Webhook Vendas da TMB (campos relevantes)
const payloadEfetivado = {
  produtor: "Instituto Vestigium",
  lancamento: "Mentoria Vestigium - Perito Criminal",
  provedor_negociado: "TMB",
  pedido: 166051,
  status_pedido: "Efetivado",
  cliente: "Fulano de Tal",
  documento: "069.242.814-00",
  email: "fulano@gmail.com",
  parcelas: 11,
  valor_total: 1997.0,
  titulo: "RC - R$ 1.997,00",
  telefones: "+5562988887777",
  telefone_ativo: "+5562999996666",
  id: 300123,
};

describe("webhook /webhook/pagamento-tmb", () => {
  beforeEach(() => {
    processarMock.mockClear();
  });

  test("rejeita requisição sem o header de autenticação correto", async () => {
    const res = await pagamentoTmbRouter.handle(
      makeRequest(payloadEfetivado, { "x-tmb-token": "errado" }),
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as { status: string; reason: string };
    expect(data.reason).toBe("unauthorized");
    expect(processarMock).not.toHaveBeenCalled();
  });

  test("ignora status_pedido diferente de Efetivado (ex.: Cancelado)", async () => {
    const res = await pagamentoTmbRouter.handle(
      makeRequest({ ...payloadEfetivado, status_pedido: "Cancelado" }),
    );
    const data = (await res.json()) as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("not_efetivado");
    expect(processarMock).not.toHaveBeenCalled();
  });

  test("aceita venda Efetivada e chama o processamento com os campos mapeados", async () => {
    const res = await pagamentoTmbRouter.handle(makeRequest(payloadEfetivado));
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe("accepted");

    expect(processarMock).toHaveBeenCalledTimes(1);
    const args = processarMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toEqual({
      nome: "Fulano de Tal",
      email: "fulano@gmail.com",
      telefone: "+5562999996666", // telefone_ativo tem prioridade sobre telefones
      nomeProduto: "Mentoria Vestigium - Perito Criminal",
      nomeOferta: "RC - R$ 1.997,00",
    });
  });

  test("usa 'telefones' quando 'telefone_ativo' está ausente", async () => {
    const { telefone_ativo, ...semAtivo } = payloadEfetivado;
    await pagamentoTmbRouter.handle(makeRequest(semAtivo));
    const args = processarMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.telefone).toBe("+5562988887777");
  });

  test("erro quando não há telefone nem email para localizar o contato", async () => {
    const { telefone_ativo, telefones, email, ...semContato } = payloadEfetivado;
    const res = await pagamentoTmbRouter.handle(makeRequest(semContato));
    const data = (await res.json()) as { status: string; reason: string };
    expect(data.status).toBe("error");
    expect(data.reason).toBe("no_contact_data");
    expect(processarMock).not.toHaveBeenCalled();
  });
});
