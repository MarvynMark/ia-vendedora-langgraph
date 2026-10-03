import { describe, test, expect } from "bun:test";
import { extrairJson } from "../../src/scripts/destilar-intervencoes.ts";

describe("extrairJson — resposta do modelo vira JSON", () => {
  test("array puro", () => {
    expect(extrairJson<number[]>("[1, 2]")).toEqual([1, 2]);
  });

  test("embrulhado em bloco ```json com texto antes", () => {
    expect(extrairJson<Array<{ i: number }>>('Aqui está:\n```json\n[{"i": 0}]\n```')).toEqual([{ i: 0 }]);
  });

  test("texto antes do array, sem bloco", () => {
    expect(extrairJson<Array<{ a: string }>>('Resultado: [{"a": "x"}]')).toEqual([{ a: "x" }]);
  });
});
