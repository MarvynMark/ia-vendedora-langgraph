import { describe, expect, test } from "bun:test";
import {
  temMarcadorDoRoteiro,
  marcadoresDoRoteiro,
  removerMarcadoresDoRoteiro,
  instrucaoPreencherMarcadores,
} from "../../src/lib/placeholder.ts";

// Saída real do modelo na conv 9486 (02/10), Mensagem 7 copiada com os marcadores.
const MENSAGEM_7_VAZADA =
  "[eco curto da dor dele], e olha, a hora de começar é agora, no pré-edital: o salário de perito é bem atrativo, então quando o edital [do concurso] sair todo mundo começa a estudar ao mesmo tempo, e aí já é tarde demais, vira questão de sorte.\n\n" +
  "Sou perito criminal há mais de 10 anos, já passaram mais de 11.500 alunos por mim, com centenas de aprovados, e no último Perito do RS 93% dos meus alunos passaram pras próximas fases.\n\n" +
  "E como eu acompanho cada um de perto, quando o edital sai eu fecho as vagas da mentoria. Ficou claro como a mentoria te ajuda a resolver [o problema que ele relatou, com a palavra dele]?";

describe("temMarcadorDoRoteiro", () => {
  test("pega marcador no meio da frase (conv 9486)", () => {
    expect(temMarcadorDoRoteiro(MENSAGEM_7_VAZADA)).toBe(true);
    expect(marcadoresDoRoteiro(MENSAGEM_7_VAZADA)).toEqual([
      "[eco curto da dor dele]",
      "[do concurso]",
      "[o problema que ele relatou, com a palavra dele]",
    ]);
  });

  test("pega marcadores curtos do roteiro", () => {
    expect(temMarcadorDoRoteiro("Pronto pro concurso da [concurso]?")).toBe(true);
    expect(temMarcadorDoRoteiro("[NOME], deixa eu recapitular.")).toBe(true);
  });

  test("texto normal, link e link markdown passam", () => {
    expect(temMarcadorDoRoteiro("Sem cronograma fica difícil saber por onde começar.")).toBe(false);
    expect(temMarcadorDoRoteiro("Segue o link: https://pay.exemplo.com/abc?x=1")).toBe(false);
    expect(temMarcadorDoRoteiro("Veja [aqui](https://exemplo.com)")).toBe(false);
  });
});

describe("removerMarcadoresDoRoteiro", () => {
  test("arranca os colchetes e conserta a pontuação", () => {
    const limpo = removerMarcadoresDoRoteiro(MENSAGEM_7_VAZADA);
    expect(temMarcadorDoRoteiro(limpo)).toBe(false);
    expect(limpo).toStartWith("E olha, a hora de começar é agora");
    expect(limpo).toContain("quando o edital sair todo mundo");
    expect(limpo).toContain("Sou perito criminal há mais de 10 anos");
    expect(limpo).toEndWith("te ajuda a resolver?");
  });

  test("linha que era só marcador some", () => {
    expect(removerMarcadoresDoRoteiro("[print enviado: aprovado]\nOlha esse resultado.")).toBe("Olha esse resultado.");
  });

  test("texto sem marcador não muda", () => {
    expect(removerMarcadoresDoRoteiro("Oi, tudo bem?\n\nComo tá a rotina?")).toBe("Oi, tudo bem?\n\nComo tá a rotina?");
  });
});

test("instrução de reescrita cita os marcadores encontrados", () => {
  const i = instrucaoPreencherMarcadores(MENSAGEM_7_VAZADA);
  expect(i).toContain("[eco curto da dor dele]");
  expect(i).toContain("Não chame nenhuma ferramenta");
});
