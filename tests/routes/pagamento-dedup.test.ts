import { describe, test, expect } from "bun:test";
import { montarChaveIdempotenciaPagamento } from "../../src/lib/idempotencia-pagamento.ts";

// Regressão do bug de duplicação: webhooks de pagamento reenviados (2x em segundos)
// disparavam notificação ao grupo e boas-vindas em dobro por uma corrida TOCTOU.
// A correção adquire um lock atômico chaveado por esta função ANTES de processar.
// Aqui garantimos as propriedades críticas da chave; o comportamento de abortar sob
// lock ativo é exercitado com processarPagamentoAprovado real (roda isolado, pois
// pagamento-tmb.test.ts stuba o módulo inteiro na suíte completa).
describe("montarChaveIdempotenciaPagamento", () => {
  test("usa o telefone com prefixo 'pagamento:' (evita colisão com lock do agente)", () => {
    // O agente principal usa o telefone PURO ("+5527997011485") como session_id na
    // mesma tabela — o prefixo é o que impede um lock bloquear o outro.
    const chave = montarChaveIdempotenciaPagamento({ telefone: "+5527997011485" });
    expect(chave).toBe("pagamento:+5527997011485");
    expect(chave).not.toBe("+5527997011485");
  });

  test("dois webhooks da MESMA venda geram a MESMA chave (dedup funciona)", () => {
    const venda = { telefone: "+5527997011485", email: "joyce@x.com", nome: "Joyce" };
    expect(montarChaveIdempotenciaPagamento(venda)).toBe(montarChaveIdempotenciaPagamento({ ...venda }));
  });

  test("cai para email e depois nome quando falta telefone", () => {
    expect(montarChaveIdempotenciaPagamento({ email: "joyce@x.com" })).toBe("pagamento:joyce@x.com");
    expect(montarChaveIdempotenciaPagamento({ nome: "Joyce" })).toBe("pagamento:Joyce");
  });

  test("último recurso 'desconhecido' quando não há nenhum identificador", () => {
    expect(montarChaveIdempotenciaPagamento({})).toBe("pagamento:desconhecido");
  });
});
