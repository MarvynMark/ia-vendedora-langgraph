import { describe, expect, test } from "bun:test";
import { pendenciaDoLead, type MensagemConversa } from "../../src/lib/varredura-fila.ts";

const ia = (id: number, content: string): MensagemConversa => ({ id, message_type: 1, content });
const nota = (id: number, content: string): MensagemConversa => ({ id, message_type: 1, private: true, content });
const lead = (id: number, content: string): MensagemConversa => ({ id, message_type: 0, content });
const audio = (id: number): MensagemConversa => ({ id, message_type: 0, content: null, attachments: [{ file_type: "audio" }] });

describe("pendenciaDoLead", () => {
  test("conv 9949: dois áudios transcritos depois da pergunta da IA ficam pendentes", () => {
    const r = pendenciaDoLead([
      ia(1, "O que dessa lista você não tem hoje?"),
      audio(2),
      nota(3, "Transcrição do áudio: <mensagem-de-audio>só tenho a plataforma</mensagem-de-audio>"),
      audio(4),
      nota(5, "Transcrição do áudio: <mensagem-de-audio>e não tenho acompanhamento</mensagem-de-audio>"),
    ]);
    expect(r).toEqual({
      idMensagem: "4",
      conteudo: "<mensagem-de-audio>só tenho a plataforma</mensagem-de-audio>\n<mensagem-de-audio>e não tenho acompanhamento</mensagem-de-audio>",
    });
  });

  test("texto do lead depois da IA fica pendente, juntando as mensagens picadas", () => {
    expect(pendenciaDoLead([ia(1, "oi"), lead(2, "quero"), lead(3, "saber o valor")]))
      .toEqual({ idMensagem: "3", conteudo: "quero\nsaber o valor" });
  });

  test("IA já respondeu: nada pendente", () => {
    expect(pendenciaDoLead([lead(1, "oi"), ia(2, "oi, tudo bem?")])).toBeNull();
  });

  test("nota privada sozinha não é resposta da IA", () => {
    expect(pendenciaDoLead([ia(1, "oi"), lead(2, "tá"), nota(3, "lead quente")]))
      .toEqual({ idMensagem: "2", conteudo: "tá" });
  });

  test("áudio sem transcrição não gera pendência", () => {
    expect(pendenciaDoLead([ia(1, "oi"), audio(2)])).toBeNull();
  });
});
