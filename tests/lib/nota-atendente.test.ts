import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mesmo cuidado do alertar-gestor.test.ts: mock.module vaza entre arquivos, então preservamos os
// módulos reais e trocamos só o que este arquivo observa.
const enviadas: Array<{ conversa: unknown; texto: string; opts?: { private?: boolean } }> = [];
let falharEnvio = false;
const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  enviarMensagem: async (_c: unknown, conversa: unknown, texto: string, opts?: { private?: boolean }) => {
    if (falharEnvio) throw new Error("falha de rede");
    enviadas.push({ conversa, texto, opts });
  },
  listarMensagens: async () => ({ payload: [{ message_type: 0, created_at: 1, content: "tá caro pra mim" }] }),
}));

const travas = new Set<string>();
const liberadas: string[] = [];
const alertasReal = await import("../../src/db/alertas.ts");
mock.module("../../src/db/alertas.ts", () => ({
  ...alertasReal,
  reivindicarAlerta: async (chave: string) => {
    if (travas.has(chave)) return false;
    travas.add(chave);
    return true;
  },
  liberarAlerta: async (chave: string) => {
    travas.delete(chave);
    liberadas.push(chave);
  },
  listarAlertasDesde: async () => [],
}));

const formularioReal = await import("../../src/db/formulario.ts");
mock.module("../../src/db/formulario.ts", () => ({
  ...formularioReal,
  buscarDadosFormulario: async () =>
    "Concurso: PCDF | Formação: Biologia | Disposto a investir: Até R$ 200 | Quando pretende entrar: Imediatamente",
}));

const { quandoAbordar, formatarNota, campoDoFormulario, chaveNota, criarNotaAtendente, motivoDaObjecao } =
  await import("../../src/lib/nota-atendente.ts");

// Sexta, 09/10/2026 12:00 em São Paulo.
const SEXTA = new Date("2026-10-09T15:00:00Z");
const DIA = 86_400_000;

describe("quandoAbordar", () => {
  test("quem está esperando a gente é hoje", () => {
    expect(quandoAbordar("sem_resposta", SEXTA).quando).toEqual(SEXTA);
    expect(quandoAbordar("escolheu_sem_link", SEXTA).quando).toEqual(SEXTA);
  });

  test("preço é D+7 e sumiço pós-pitch é D+5", () => {
    expect(quandoAbordar("preco", SEXTA).quando.getTime() - SEXTA.getTime()).toBe(7 * DIA);
    // D+5 de sexta cai na quarta.
    expect(quandoAbordar("sumiu_pos_pitch", SEXTA).quando.getTime() - SEXTA.getTime()).toBe(5 * DIA);
  });

  test("adiou com data combinada respeita a data", () => {
    const combinado = new Date("2026-10-20T13:05:00Z");
    expect(quandoAbordar("adiou", SEXTA, combinado).quando).toEqual(combinado);
  });

  test("nunca cai no domingo", () => {
    // D+2 de sexta seria domingo → segunda.
    const quinta = new Date(SEXTA.getTime() - DIA);
    const r = quandoAbordar("adiou", quinta); // D+3 de quinta = domingo
    expect(new Date(r.quando.getTime() - 3 * 3600_000).getUTCDay()).toBe(1);
  });
});

describe("formatarNota", () => {
  const dados = "Concurso: PCDF | Formação: Medicina | Disposto a investir: Sim | Quando pretende entrar: Imediatamente";

  test("traz motivo, quando, mensagens e perfil", () => {
    const texto = formatarNota({
      motivo: "preco",
      quando: quandoAbordar("preco", SEXTA),
      conteudo: { porQueTravou: 'disse "tá caro"', comoAbordar: ["Oi, Ana!"], oQueEvitar: "repetir o parcelamento" },
      dadosFormulario: dados,
    });
    expect(texto).toContain("🧭 NOTA PRO ATENDENTE — travou no preço / orçamento");
    expect(texto).toContain("16/10 (sex)");
    expect(texto).toContain('"Oi, Ana!"');
    expect(texto).toContain("bônus extra ou uma condição exclusiva");
    expect(texto).toContain("Perfil: PCDF · médico legista · quer entrar: Imediatamente · investe: Sim");
  });

  test("nunca fala em cupom ou desconto", () => {
    const texto = formatarNota({ motivo: "preco", quando: quandoAbordar("preco", SEXTA), conteudo: null, dadosFormulario: "" });
    expect(texto).not.toMatch(/cupom|desconto|%/i);
  });

  test("sem o conteúdo do modelo sai só a parte fixa", () => {
    const texto = formatarNota({ motivo: "sumiu_conexao", quando: quandoAbordar("sumiu_conexao", SEXTA), conteudo: null, dadosFormulario: "" });
    expect(texto).not.toContain("Por que travou");
    expect(texto).toContain("Quando abordar:");
  });
});

test("campoDoFormulario lê a string do formulário", () => {
  expect(campoDoFormulario("Concurso: PCDF | Idade: 30", "Concurso")).toBe("PCDF");
  expect(campoDoFormulario("Idade: 30", "Concurso")).toBe("");
});

test("chaveNota separa objeção por tipo e sumiço por etapa", () => {
  expect(chaveNota(10, { tipo: "objecao", objecao: "preco", fala: "", resposta: "" })).toBe("nota:10:preco");
  expect(chaveNota(10, { tipo: "sumico", etapa: "Aguardando Pagamento", motivoProvavel: "sumiu_pos_pitch" }))
    .toBe("nota:10:sumiu:aguardando-pagamento");
  expect(motivoDaObjecao("pagamento")).toBe("forma_pagamento");
});

describe("criarNotaAtendente", () => {
  // Sem chave real da OpenAI o modelo falha e a nota sai com a parte fixa — que é o comportamento
  // que importa aqui: a nota sai mesmo assim, uma vez só, e privada.
  beforeEach(() => {
    enviadas.length = 0;
    liberadas.length = 0;
    travas.clear();
    falharEnvio = false;
  });

  const objecao = { tipo: "objecao" as const, objecao: "preco" as const, fala: "tá caro", resposta: "Te entendo." };

  test("cria UMA nota privada por gatilho", async () => {
    expect(await criarNotaAtendente({ idConversa: 5, telefone: "5561999990000", nome: "Ana", gatilho: objecao })).toBe("preco");
    expect(await criarNotaAtendente({ idConversa: 5, telefone: "5561999990000", nome: "Ana", gatilho: objecao })).toBeNull();
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.opts?.private).toBe(true);
    expect(enviadas[0]!.texto).toContain("Perfil: PCDF · perito");
  }, 70_000);

  test("falha no envio libera a trava e não lança", async () => {
    falharEnvio = true;
    expect(await criarNotaAtendente({ idConversa: 6, telefone: "5561999990000", nome: "Ana", gatilho: objecao })).toBeNull();
    expect(liberadas).toEqual(["nota:6:preco"]);
  }, 70_000);
});
