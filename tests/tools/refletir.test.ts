import { describe, test, expect } from "bun:test";
import { refletir } from "../../src/tools/refletir.ts";

describe("refletir tool", () => {
  test("retorna o pensamento fornecido", async () => {
    const resultado = await refletir.invoke({ thought: "Preciso verificar o horário" });
    expect(resultado).toBe("Preciso verificar o horário");
  });

  test("tem o nome correto", () => {
    expect(refletir.name).toBe("Refletir");
  });

  test("tem a descrição correta", () => {
    expect(refletir.description).toContain("refletir sobre algo");
  });
});
