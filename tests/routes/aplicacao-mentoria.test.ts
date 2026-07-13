import { describe, test, expect } from "bun:test";
import { montarDescricaoTarefa } from "../../src/routes/aplicacao-mentoria.ts";

// Regressão do card com "Concurso: não informado" (conversa 3995): a descrição lia
// d.qual_concurso (nome do atributo do Chatwoot), mas o formulário parseado usa a chave
// concurso_desejado (do CAMPO_MAP). O resultado era SEMPRE "não informado".
describe("montarDescricaoTarefa", () => {
  test("usa o concurso do formulário (concurso_desejado)", () => {
    const desc = montarDescricaoTarefa({ concurso_desejado: "PCDF", disposto_investir: "Infelizmente não no momento!" });
    expect(desc).toContain("Concurso: PCDF");
    expect(desc).not.toContain("não informado");
  });

  test("cai para 'não informado' só quando o concurso realmente não veio", () => {
    const desc = montarDescricaoTarefa({ disposto_investir: "Sim" });
    expect(desc).toContain("Concurso: não informado");
  });

  test("emoji 🟢 quando disposto a investir, 🟣 caso contrário", () => {
    expect(montarDescricaoTarefa({ concurso_desejado: "PF", disposto_investir: "Sim, com certeza!" })).toContain("🟢");
    expect(montarDescricaoTarefa({ concurso_desejado: "PF", disposto_investir: "Infelizmente não no momento!" })).toContain("🟣");
  });

  test("mantém as 3 linhas do formato do card", () => {
    const linhas = montarDescricaoTarefa({ concurso_desejado: "PCDF" }).split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toBe("🔁 - Follow-ups: 0");
    expect(linhas[2]).toBe("👤 - Descrição: inicio");
  });
});
