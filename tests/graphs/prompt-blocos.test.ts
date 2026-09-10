import { describe, test, expect } from "bun:test";
import { BLOCO_PAPEL, BLOCO_PERSONALIDADE, BLOCO_RAG } from "../../src/graphs/main-agent/prompt-blocos.ts";
import { gerarPromptAgentePrincipal } from "../../src/graphs/main-agent/prompt.ts";

const ctx = {
  tarefa: { board_step: { name: "Conexao" }, board_step_id: 10, title: "Maria Silva" },
  etapasDescricao: "Conexao: 10",
  dataHoraAtual: "10/09/2026 14:30",
  dadosFormulario: "Concurso: PCDF | Formação: Biomedicina",
  nomeLead: "Maria Silva",
  etiquetas: ["agente-on"],
};

describe("blocos compartilhados entre as duas trilhas", () => {
  // Estes três blocos foram RECORTADOS de prompt.ts para serem reusados por prompt-sessao.ts.
  // O risco da extração é alterar sem querer o prompt que roda hoje em produção; os testes abaixo
  // garantem que o texto continua entrando inteiro e na ordem certa.
  test("entram VERBATIM no prompt do funil antigo", () => {
    const p = gerarPromptAgentePrincipal(ctx);
    expect(p).toContain(BLOCO_PAPEL);
    expect(p).toContain(BLOCO_PERSONALIDADE);
    expect(p).toContain(BLOCO_RAG);
  });

  test("na ordem original: papel → personalidade → ... → RAG", () => {
    const p = gerarPromptAgentePrincipal(ctx);
    expect(p.indexOf(BLOCO_PAPEL)).toBeLessThan(p.indexOf(BLOCO_PERSONALIDADE));
    expect(p.indexOf(BLOCO_PERSONALIDADE)).toBeLessThan(p.indexOf(BLOCO_RAG));
  });

  test("o prompt começa pelo papel — o prefixo estável que a OpenAI cacheia", () => {
    expect(gerarPromptAgentePrincipal(ctx).startsWith(BLOCO_PAPEL)).toBe(true);
  });

  test("nenhum bloco carrega dado de lead (senão quebraria o cache de prefixo)", () => {
    for (const b of [BLOCO_PAPEL, BLOCO_PERSONALIDADE, BLOCO_RAG]) {
      expect(b).not.toContain("Maria");
      expect(b).not.toContain("PCDF");
      expect(b).not.toContain("${");
    }
  });
});
