import { describe, test, expect } from "bun:test";
import { montarDescricaoTarefa, nomeEhPlaceholderContato, parsearFormulario } from "../../src/routes/aplicacao-mentoria.ts";

// O formulário é reformulado com frequência; o mapeamento agora casa por PADRÃO (não por texto
// exato), então rewordings normais não devem quebrar a extração dos campos (regressão conv 4549:
// coluna virava null → detecção de médico quebrava).
describe("parsearFormulario (mapeamento por padrão)", () => {
  test("Perito: payload achatado do form atual popula todas as colunas certas", () => {
    const d = parsearFormulario({
      "Qual é o seu nome completo?": "Maria Silva",
      "Qual é o seu WhatsApp?": "5511999998888",
      "Qual é o seu e-mail?": "maria@ex.com",
      "Qual é a sua graduação superior?": "Direito",
      "Qual é o concurso de Perito Criminal você deseja prestar?": "PCDF",
      "Qual é sua maior dificuldade frente aos estudos para concurso de Perito Criminal?": "Constância",
      "O que te fez dar o primeiro passo em busca de uma mentoria?": "Mudar de vida",
      "Por fim: se seu formulário for aprovado, você estaria pronto para começar na mentoria hoje?": "Sim",
    });
    expect(d).toEqual({
      nome_completo: "Maria Silva",
      whatsapp: "5511999998888",
      email: "maria@ex.com",
      area_graduacao: "Direito",
      concurso_desejado: "PCDF",
      maior_dificuldade: "Constância",
      motivo_mentoria: "Mudar de vida",
      pronto_para_garantir: "Sim",
    });
  });

  test("concurso e dificuldade não se confundem (ambas as perguntas contêm 'concurso')", () => {
    const d = parsearFormulario({
      "Qual é o concurso de Perito Criminal você deseja prestar?": "PCMA",
      "Qual é sua maior dificuldade frente aos estudos para concurso de Perito Criminal?": "Tempo",
    });
    expect(d.concurso_desejado).toBe("PCMA");
    expect(d.maior_dificuldade).toBe("Tempo");
  });

  test("Médico: 'Você é?' mapeia para graduação e o concurso/dificuldade continuam corretos", () => {
    const d = parsearFormulario({
      "Você é?": "Médica",
      "Qual é o concurso de Perito Médico Legista você deseja prestar?": "IML-SP",
      "Qual é sua maior dificuldade frente aos estudos para concurso?": "Rotina do plantão",
    });
    expect(d.area_graduacao).toBe("Médica");
    expect(d.concurso_desejado).toBe("IML-SP");
    expect(d.maior_dificuldade).toBe("Rotina do plantão");
  });

  test("'disposto a investir' foi removido: se vier no payload, é ignorado (não vira coluna)", () => {
    const d = parsearFormulario({
      "Você está disposto e teria condições de investir cerca de R$ 197 por mês?": "Não",
      "Qual é o seu nome completo?": "João",
    });
    expect(d.nome_completo).toBe("João");
    expect(d).not.toHaveProperty("disposto_investir");
  });
});

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

  // O sinal de lead quente passou a se basear em "pronto para garantir" (o "disposto a investir"
  // saiu do formulário com a unificação do fluxo).
  test("emoji 🟢 quando 'pronto para garantir' afirmativo, 🟣 caso contrário", () => {
    expect(montarDescricaoTarefa({ concurso_desejado: "PF", pronto_para_garantir: "Sim, com certeza!" })).toContain("🟢");
    expect(montarDescricaoTarefa({ concurso_desejado: "PF", pronto_para_garantir: "Ainda não sei" })).toContain("🟣");
    expect(montarDescricaoTarefa({ concurso_desejado: "PF" })).toContain("🟣");
  });

  test("mantém as 3 linhas do formato do card", () => {
    const linhas = montarDescricaoTarefa({ concurso_desejado: "PCDF" }).split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toBe("🔁 - Follow-ups: 0");
    expect(linhas[2]).toBe("👤 - Descrição: inicio");
  });
});

// Regressão da conv 4442: contato pré-existente ficou com o telefone como nome porque o branch de
// atualização não corrigia o nome. Só sobrescrevemos quando o nome atual é placeholder.
describe("nomeEhPlaceholderContato", () => {
  test("é placeholder: telefone, só dígitos, vazio", () => {
    expect(nomeEhPlaceholderContato("5521992887269")).toBe(true);
    expect(nomeEhPlaceholderContato("+55 21 99288-7269")).toBe(true);
    expect(nomeEhPlaceholderContato("(21) 99288-7269")).toBe(true);
    expect(nomeEhPlaceholderContato("")).toBe(true);
    expect(nomeEhPlaceholderContato("   ")).toBe(true);
    expect(nomeEhPlaceholderContato(null)).toBe(true);
    expect(nomeEhPlaceholderContato(undefined)).toBe(true);
  });

  test("NÃO é placeholder: nome real (tem letra) não é sobrescrito", () => {
    expect(nomeEhPlaceholderContato("Monique G H Ferraz")).toBe(false);
    expect(nomeEhPlaceholderContato("Ana")).toBe(false);
    expect(nomeEhPlaceholderContato("José 2")).toBe(false);
  });
});
