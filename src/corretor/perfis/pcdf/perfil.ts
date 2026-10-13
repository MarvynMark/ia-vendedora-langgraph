// Perfil Perito Criminal PCDF — régua do Edital nº 1/2016 (IADES), item 13.
//
// Os .md desta pasta vieram do GPT "Professor Vestigium — Discursiva PCDF" do Walker:
// instrucoes.md (Habilidade, adaptada para só corrigir), espelho.md (Espelho de Correção, sem as
// seções de formato de saída e simulado), calibracao.md e conteudo/ (Anexo I do edital, por área).
// banco.json é o Banco de Questões autorais (G01–G20 gerais; E01–E08 por área 101–109).
import { readFileSync } from "node:fs";
import type { PerfilConcurso, QuestaoBanco } from "../../tipos.ts";
import banco from "./banco.json" with { type: "json" };

function ler(arquivo: string): string {
  return readFileSync(new URL(arquivo, import.meta.url), "utf-8").trim();
}

const AREAS: Record<string, string> = {
  "101": "Ciências Biológicas",
  "102": "Ciências Contábeis",
  "103": "Ciência da Computação/Informática",
  "104": "Engenharia",
  "105": "Farmácia/Bioquímica",
  "106": "Física",
  "107": "Geologia",
  "108": "Odontologia",
  "109": "Química",
};

const INSTRUCOES = ler("./instrucoes.md");
const ESPELHO = ler("./espelho.md");
const CALIBRACAO = ler("./calibracao.md");
const CONTEUDO_GERAIS = ler("./conteudo/gerais.md");
const CONTEUDO_AREA: Record<string, string> = Object.fromEntries(
  Object.keys(AREAS).map((c) => [c, ler(`./conteudo/${c}.md`)]),
);

export const perfilPcdf: PerfilConcurso = {
  codigo: "pcdf",
  nome: "Perito Criminal PCDF",
  banca: "IADES",
  notaMaximaQuestao: 25,
  linhasMin: 10,
  linhasMax: 15,
  caracteresPorLinha: 70,
  criterios: [
    { sigla: "TX", nome: "Tema/Texto", maximo: 5 },
    { sigla: "AR", nome: "Argumentação", maximo: 5 },
    { sigla: "CA", nome: "Coerência Argumentativa", maximo: 5 },
    { sigla: "EC", nome: "Elaboração Crítica", maximo: 10 },
  ],
  // Edital 13.7.5: NQ = DQ − ((NE/TL) × 1); 13.7.6: NQ < 0 vira zero (aplicado em calcularNota).
  formulaTexto: "NQ = DQ − (NE / TL)",
  formula: ({ dq, ne, tl }) => dq - ne / tl,
  areas: AREAS,
  banco: banco as QuestaoBanco[],
  aviso: "Padrão histórico do Edital nº 1/2016 (IADES) — referência de treino, não regra confirmada do próximo edital.",
  promptSistema: (area) => {
    const blocoArea = area && CONTEUDO_AREA[area]
      ? `\n\nÁrea de formação do aluno: ${AREAS[area]} (código ${area}).\n\n${CONTEUDO_AREA[area]}`
      : "\n\nÁrea de formação do aluno: não informada.";
    return [
      INSTRUCOES,
      `# METODOLOGIA DE CORREÇÃO (documento "Espelho de Correção Discursivas PCDF")\n\n${ESPELHO}`,
      `# CALIBRAÇÃO (uso interno — não cite as faixas ao aluno como se fossem oficiais)\n\n${CALIBRACAO}`,
      `# CONTEÚDO PROGRAMÁTICO DE REFERÊNCIA (Anexo I do Edital nº 1/2016)\n\n${CONTEUDO_GERAIS}${blocoArea}`,
    ].join("\n\n---\n\n");
  },
};
