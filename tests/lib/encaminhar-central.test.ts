import { describe, test, expect } from "bun:test";
import { semCpf } from "../../src/lib/encaminhar-central.ts";

describe("semCpf (pagamento encaminhado para a Central)", () => {
  test("remove o CPF da Guru (contact.doc), inclusive dentro de payload", () => {
    const r = semCpf({ payload: { contact: { name: "Ana", doc: "07512345622", email: "a@x.com" }, status: "approved" } });
    expect(r).toEqual({ payload: { contact: { name: "Ana", email: "a@x.com" }, status: "approved" } });
  });
  test("remove o CPF da TMB (documento) e mantém o resto", () => {
    const r = semCpf({ cliente: "Ana", documento: "069.242.814-00", itens: [{ cpf: "1", valor: 10 }] });
    expect(r).toEqual({ cliente: "Ana", itens: [{ valor: 10 }] });
  });
});
