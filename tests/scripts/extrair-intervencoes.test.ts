import { describe, test, expect } from "bun:test";
import { autorDe, recortarIntervencoes, type Mensagem } from "../../src/scripts/extrair-intervencoes.ts";

let id = 0;
const lead = (t: string, ts: number): Mensagem => ({ id: ++id, content: t, message_type: 0, created_at: ts, sender: { id: 99, type: "contact" } });
const ia = (t: string, ts: number): Mensagem => ({ id: ++id, content: t, message_type: 1, created_at: ts, sender: { id: 3, type: "user" } });
const pedro = (t: string, ts: number): Mensagem => ({ id: ++id, content: t, message_type: 1, created_at: ts, sender: { id: 5, type: "user" } });

describe("autorDe", () => {
  test("separa lead, IA, Gusthavo, Pedro, equipe e mensagem sem autor", () => {
    expect(autorDe(lead("oi", 1))).toBe("LEAD");
    expect(autorDe(ia("oi", 1))).toBe("IA");
    expect(autorDe(pedro("oi", 1))).toBe("Pedro");
    expect(autorDe({ id: 1, content: "oi", message_type: 1, created_at: 1, sender: { id: 1 } })).toBe("Gusthavo");
    expect(autorDe({ id: 1, content: "oi", message_type: 1, created_at: 1, sender: { id: 6 } })).toBe("EQUIPE");
    expect(autorDe({ id: 1, content: "oi", message_type: 1, created_at: 1, sender: null })).toBe("INCERTO");
  });

  test("nota interna e atividade ficam de fora", () => {
    expect(autorDe({ id: 1, content: "nota", message_type: 1, private: true, created_at: 1, sender: { id: 5 } })).toBeNull();
    expect(autorDe({ id: 1, content: "VESTIGIUM adicionou mentoria", message_type: 2, created_at: 1 })).toBeNull();
  });
});

describe("recortarIntervencoes", () => {
  const msgs = [
    lead("quero saber da mentoria", 100),
    ia("Anual: 12x R$ 295", 200),
    lead("tá caro pra mim", 300),
    lead("vou pensar", 310),
    pedro("Entendo, o que pesa mais: o valor da parcela ou a dúvida se funciona?", 400),
    pedro("Me conta que eu te ajudo", 410),
    lead("a parcela", 500),
    pedro("Bem-vindo à mentoria!", 2000), // depois da venda: fora
  ];

  test("gatilho = falas do lead logo antes; resposta = bloco do humano; reação = o que veio depois", () => {
    const [it, ...resto] = recortarIntervencoes(1, msgs, 1000);
    expect(resto).toHaveLength(0);
    expect(it!.gatilho).toEqual(["LEAD: tá caro pra mim", "LEAD: vou pensar"]);
    expect(it!.resposta).toHaveLength(2);
    expect(it!.reacao[0]).toBe("LEAD: a parcela");
    expect(it!.autores).toEqual(["Pedro"]);
  });

  test("depois de a IA mostrar preço, a intervenção é pós-preço", () => {
    expect(recortarIntervencoes(1, msgs, 1000)[0]!.fase).toBe("pos_preco");
  });

  test("bloco com link/pix é fechamento", () => {
    const r = recortarIntervencoes(1, [lead("como pago?", 1), pedro("Te mando o link do pix", 2)], 10);
    expect(r[0]!.fase).toBe("fechamento");
  });
});
