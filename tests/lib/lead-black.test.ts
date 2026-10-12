import { describe, test, expect } from "bun:test";
import {
  COLUNAS,
  ORIGEM_BLACK,
  atributosDaPesquisa,
  eventoBlackSchema,
  indiceDoLead,
  mesclarLinha,
  telefoneE164,
  valoresDaPesquisa,
  valoresDoCadastro,
  type CadastroBlack,
  type PesquisaBlack,
} from "../../src/lib/lead-black.ts";
import { letraDaColuna } from "../../src/services/google-sheets.ts";

const LEAD = "9a7a1a50-6141-4727-9409-ea47075f4d91";

// Payloads exatamente como a LP (lista-vip/script.js) envia.
const CADASTRO = {
  evento: "cadastro",
  lead_id: LEAD,
  nome: "Ana Souza",
  whatsapp: "5511988887777",
  email: "ana@exemplo.com",
  origem: "lp-lista-vip",
  pagina: "https://lp.mentoriavestigium.com.br/lista-vip/",
  enviado_em: "2026-10-20T14:03:00.000Z",
  utm_source: "facebook",
  utm_campaign: "black-captacao",
};
const PESQUISA = {
  evento: "pesquisa",
  lead_id: LEAD,
  completa: true,
  respostas: { cargo: "Perito Criminal", tempo_estudo: "Menos de 6 meses", dificuldade: "Falta de tempo", intencao: "Sim, quero entrar" },
  origem: "lp-lista-vip",
  enviado_em: "2026-10-20T14:04:00.000Z",
};

describe("eventoBlackSchema", () => {
  test("aceita o cadastro e a pesquisa que a LP envia", () => {
    expect(eventoBlackSchema.safeParse(CADASTRO).success).toBe(true);
    expect(eventoBlackSchema.safeParse(PESQUISA).success).toBe(true);
  });

  test("aceita pesquisa parcial, de quem pulou no meio", () => {
    const r = eventoBlackSchema.safeParse({ ...PESQUISA, completa: false, respostas: { cargo: "Médico Legista" } });
    expect(r.success).toBe(true);
  });

  test("recusa lead_id que não é UUID, WhatsApp com letras e evento desconhecido", () => {
    expect(eventoBlackSchema.safeParse({ ...CADASTRO, lead_id: "abc" }).success).toBe(false);
    expect(eventoBlackSchema.safeParse({ ...CADASTRO, whatsapp: "11 9888-x" }).success).toBe(false);
    expect(eventoBlackSchema.safeParse({ ...CADASTRO, evento: "outro" }).success).toBe(false);
  });
});

describe("telefoneE164", () => {
  test("põe + e o 55 só quando falta", () => {
    expect(telefoneE164("5511988887777")).toBe("+5511988887777");
    expect(telefoneE164("11988887777")).toBe("+5511988887777");
  });
});

describe("mesclarLinha", () => {
  const recebido = new Date("2026-10-20T14:03:00.000Z");
  const cadastro = eventoBlackSchema.parse(CADASTRO) as CadastroBlack;
  const pesquisa = eventoBlackSchema.parse(PESQUISA) as PesquisaBlack;

  test("aba vazia: cria o cabeçalho na ordem de COLUNAS e grava o cadastro", () => {
    const r = mesclarLinha({ cabecalho: [], linhaAtual: [], valores: valoresDoCadastro(cadastro, recebido) });
    expect(r.cabecalhoMudou).toBe(true);
    expect(r.cabecalho.slice(0, 5)).toEqual([COLUNAS.data, COLUNAS.leadId, COLUNAS.nome, COLUNAS.whatsapp, COLUNAS.email]);
    const v = (t: string) => r.linha[r.cabecalho.indexOf(t)];
    expect(v(COLUNAS.data)).toBe("20/10/2026 11:03:00");
    expect(v(COLUNAS.whatsapp)).toBe("'+5511988887777"); // apóstrofo: não vira fórmula nem número
    expect(v(COLUNAS.origem)).toBe(ORIGEM_BLACK);
  });

  test("pesquisa completa a linha do cadastro sem apagar nada", () => {
    const passo1 = mesclarLinha({ cabecalho: [], linhaAtual: [], valores: valoresDoCadastro(cadastro, recebido) });
    const passo2 = mesclarLinha({ cabecalho: passo1.cabecalho, linhaAtual: passo1.linha, valores: valoresDaPesquisa(pesquisa) });
    const v = (t: string) => passo2.linha[passo2.cabecalho.indexOf(t)];
    expect(passo2.cabecalhoMudou).toBe(false);
    expect(v(COLUNAS.nome)).toBe("Ana Souza");
    expect(v(COLUNAS.cargo)).toBe("Perito Criminal");
    expect(v(COLUNAS.pesquisaCompleta)).toBe("Sim");
  });

  test("respeita colunas que a equipe já criou e reordenou na aba", () => {
    const cabecalho = ["Nome", "Lead ID", "Observações da equipe", "WhatsApp"];
    const r = mesclarLinha({ cabecalho, linhaAtual: [], valores: valoresDoCadastro(cadastro, recebido) });
    expect(r.cabecalho.slice(0, 4)).toEqual(cabecalho);
    expect(r.linha[0]).toBe("Ana Souza");
    expect(r.linha[2]).toBe("");
  });
});

describe("indiceDoLead", () => {
  test("acha a linha pelo Lead ID, ignorando o cabeçalho", () => {
    const cab = ["Carimbo de data/hora", "Lead ID", "Nome"];
    const linhas = [cab, ["x", "outro", "B"], ["y", LEAD, "Ana"]];
    expect(indiceDoLead(linhas, cab, LEAD)).toBe(2);
    expect(indiceDoLead(linhas, cab, "nao-existe")).toBe(-1);
    expect(indiceDoLead([["Nome"]], ["Nome"], LEAD)).toBe(-1);
  });
});

describe("atributosDaPesquisa", () => {
  test("só leva as respostas dadas, com prefixo black_", () => {
    const p = eventoBlackSchema.parse({ ...PESQUISA, respostas: { cargo: "Médico Legista" } }) as PesquisaBlack;
    expect(atributosDaPesquisa(p)).toEqual({ black_cargo: "Médico Legista" });
  });
});

describe("letraDaColuna", () => {
  test("converte índice 1-based em letras", () => {
    expect(letraDaColuna(1)).toBe("A");
    expect(letraDaColuna(18)).toBe("R");
    expect(letraDaColuna(27)).toBe("AA");
  });
});
