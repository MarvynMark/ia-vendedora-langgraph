// Perfil Perito Criminal PCDF — régua do Edital nº 1/2016 (IADES), item 13.
//
// Os .md desta pasta vieram do GPT "Professor Vestigium — Discursiva PCDF" do Walker:
// instrucoes.md (Habilidade, adaptada para só corrigir), espelho.md (Espelho de Correção, sem as
// seções de formato de saída e simulado), calibracao.md, conteudo/ (Anexo I do edital, por área) e
// conteudo/padrao-*.md (padrão oficial de respostas da discursiva de 2016, IADES, por área).
// banco.json é o Banco de Questões autorais (G01–G20 gerais; E01–E08 por área 101–109 de 2016).
//
// ÁREAS: seguem a distribuição divulgada para o próximo concurso (perfil victorconcursos, nov/2026 —
// AINDA NÃO OFICIAL; revisar quando o edital sair): 15 áreas + Medicina (Área 16). Os arquivos
// continuam com os códigos de 2016; cada área nova aponta para o seu `legado`, de onde herda
// conteúdo, padrão IADES e questões E01–E08. Áreas sem legado não têm banco próprio.
import { readFileSync } from "node:fs";
import type { PerfilConcurso, QuestaoBanco } from "../../tipos.ts";
import { textoRubrica } from "../../regras.ts";
import banco from "./banco.json" with { type: "json" };

function ler(arquivo: string): string {
  return readFileSync(new URL(arquivo, import.meta.url), "utf-8").trim();
}

// O aluno escolhe pela GRADUAÇÃO (não sabe a própria área): cada item de `graduacoes` é uma opção.
const AREAS_2026: Array<{ codigo: string; graduacoes: string[]; legado: string | null }> = [
  { codigo: "1", graduacoes: ["Física"], legado: "106" },
  { codigo: "2", graduacoes: ["Fonoaudiologia"], legado: null },
  { codigo: "3", graduacoes: ["Medicina Veterinária"], legado: null },
  { codigo: "4", graduacoes: ["Odontologia"], legado: "108" },
  { codigo: "5", graduacoes: ["Análise de Sistemas", "Ciência da Computação", "Engenharia da Computação", "Engenharia de Redes de Comunicação", "Informática"], legado: "103" },
  { codigo: "6", graduacoes: ["Ciências Biológicas", "Biomedicina", "Bioquímica"], legado: "101" },
  { codigo: "7", graduacoes: ["Química", "Engenharia Química", "Química Industrial"], legado: "109" },
  { codigo: "8", graduacoes: ["Farmácia", "Farmácia Bioquímica"], legado: "105" },
  { codigo: "9", graduacoes: ["Ciências Contábeis"], legado: "102" },
  { codigo: "10", graduacoes: ["Ciências Econômicas"], legado: null },
  { codigo: "11", graduacoes: ["Geologia", "Engenharia de Minas"], legado: "107" },
  { codigo: "12", graduacoes: ["Engenharia Civil"], legado: "104" },
  { codigo: "13", graduacoes: ["Engenharia Mecânica", "Engenharia Mecatrônica"], legado: "104" },
  { codigo: "14", graduacoes: ["Engenharia Elétrica", "Engenharia Eletrônica", "Engenharia de Telecomunicações"], legado: "104" },
  { codigo: "15", graduacoes: ["Engenharia Agronômica", "Engenharia Florestal", "Engenharia Cartográfica"], legado: null },
  { codigo: "16", graduacoes: ["Medicina"], legado: null },
];

const AREAS: Record<string, string> = Object.fromEntries(AREAS_2026.map((a) => [a.codigo, a.graduacoes.join("; ")]));
const LEGADO: Record<string, string | null> = Object.fromEntries(AREAS_2026.map((a) => [a.codigo, a.legado]));
const CODIGOS_2016 = ["101", "102", "103", "104", "105", "106", "107", "108", "109"];

// Área salva por aluno antes da redistribuição. Engenharia (104) virou quatro áreas: pergunta de novo.
export const AREA_2016_PARA_2026: Record<string, string | null> = {
  "101": "6", "102": "9", "103": "5", "104": null, "105": "8", "106": "1", "107": "11", "108": "4", "109": "7",
};

// Questões E de 2016 copiadas para cada área nova que herda daquela área antiga.
const BANCO: QuestaoBanco[] = [
  ...(banco as QuestaoBanco[]).filter((q) => q.area === null),
  ...AREAS_2026.flatMap((a) => a.legado
    ? (banco as QuestaoBanco[]).filter((q) => q.area === a.legado).map((q) => ({ ...q, area: a.codigo }))
    : []),
];

const INSTRUCOES = ler("./instrucoes.md");
const ESPELHO = ler("./espelho.md");
const CALIBRACAO = ler("./calibracao.md");
const CONTEUDO_GERAIS = ler("./conteudo/gerais.md");
const CONTEUDO_AREA: Record<string, string> = Object.fromEntries(
  CODIGOS_2016.map((c) => [c, ler(`./conteudo/${c}.md`)]),
);
// Padrão oficial de respostas da discursiva de 2016 (IADES), por área — mostra o NÍVEL de exigência
// real da banca. Na questão de concurso de pessoas, por exemplo, o IADES pedia "o coautor pratica
// direta ou indiretamente o crime" e não cobrava "domínio do fato", que a IA vinha exigindo.
const PADRAO_AREA: Record<string, string> = Object.fromEntries(
  CODIGOS_2016.map((c) => [c, ler(`./conteudo/padrao-${c}.md`)]),
);
// Sem área informada: só a Questão 1, comum a todas as áreas.
const PADRAO_COMUM = PADRAO_AREA["101"]!.split(/\n(?=Questão 2 )/)[0]!;

export const perfilPcdf: PerfilConcurso = {
  codigo: "pcdf",
  nome: "Perito Criminal PCDF",
  banca: "IADES",
  notaMaximaQuestao: 25,
  linhasMin: 10,
  linhasMax: 15,
  caracteresPorLinha: 70,
  // Rubrica didática Vestigium (rascunho de 13/10/2026, a validar pelo Walker): o edital diz o que
  // cada critério mede, mas não publica faixas. Os descritores falam de itens EXIGIDOS pelo comando —
  // aprofundamento ausente nunca rebaixa de faixa.
  criterios: [
    {
      sigla: "TX", nome: "Tema/Texto", maximo: 5,
      avalia: "adequação ao tema, à proposta e ao comando; organização textual",
      // "Responde a todos os itens" é contagem: sem item ausente, no mínimo B (A ou B é organização);
      // com item ausente, no máximo C ou D.
      faixaPeloEspelho: (c) => (c.naoAtendidos >= 2 ? { teto: "D" } : c.naoAtendidos === 1 ? { teto: "C" } : { piso: "B" }),
      faixas: [
        { codigo: "A", min: 4.5, max: 5, descritor: "responde a todos os itens exigidos pelo comando, sem trechos fora do tema, com organização funcional" },
        { codigo: "B", min: 3.5, max: 4, descritor: "responde a todos os itens exigidos, com pequena falha de organização (ordem confusa ou trecho dispensável)" },
        { codigo: "C", min: 2.5, max: 3, descritor: "deixa de abordar 1 item exigido, ou a organização prejudica a leitura" },
        { codigo: "D", min: 1, max: 2, descritor: "deixa de abordar 2 ou mais itens exigidos, ou só tangencia o tema" },
        { codigo: "E", min: 0, max: 0.5, descritor: "praticamente não responde ao comando" },
      ],
    },
    {
      sigla: "AR", nome: "Argumentação", maximo: 5,
      avalia: "conhecimento do assunto; seleção de ideias, articulação e consistência",
      // Os descritores de AR são contagem de itens exigidos: a faixa sai do espelho, não da IA.
      // Com item incorreto, a IA julga a gravidade, mas no máximo C.
      faixaPeloEspelho: (c) => {
        if (c.incorretos > 0) return { teto: "C" };
        if (c.naoAtendidos >= 2) return { exata: "D" };
        if (c.naoAtendidos === 1 || c.parciais >= 3) return { exata: "C" };
        if (c.parciais >= 1) return { exata: "B" };
        return { exata: "A" };
      },
      faixas: [
        { codigo: "A", min: 4.5, max: 5, descritor: "todos os elementos EXIGIDOS atendidos com precisão técnica; nenhum incorreto" },
        { codigo: "B", min: 3.5, max: 4, descritor: "todos os elementos exigidos presentes, mas 1 ou 2 parciais (superficiais ou imprecisos); nenhum incorreto central" },
        { codigo: "C", min: 2.5, max: 3, descritor: "1 elemento exigido não atendido, ou 3 ou mais parciais, ou 1 imprecisão conceitual relevante" },
        { codigo: "D", min: 1, max: 2, descritor: "2 ou mais elementos exigidos não atendidos, ou erro conceitual central" },
        { codigo: "E", min: 0, max: 0.5, descritor: "conhecimento ausente ou majoritariamente incorreto" },
      ],
    },
    {
      sigla: "CA", nome: "Coerência Argumentativa", maximo: 5,
      avalia: "ordenação dos argumentos; relação entre premissas, conclusões e consequências",
      faixas: [
        { codigo: "A", min: 4.5, max: 5, descritor: "progressão lógica clara, sem contradição; as conclusões decorrem do que foi afirmado" },
        { codigo: "B", min: 3.5, max: 4, descritor: "progressão adequada, com 1 salto lógico ou conexão frouxa entre ideias" },
        { codigo: "C", min: 2.5, max: 3, descritor: "ideias justapostas sem relação explícita, ou 1 contradição pontual" },
        { codigo: "D", min: 1, max: 2, descritor: "fragmentação ou contradições que comprometem o sentido" },
        { codigo: "E", min: 0, max: 0.5, descritor: "sem encadeamento lógico" },
      ],
    },
    {
      sigla: "EC", nome: "Elaboração Crítica", maximo: 10,
      avalia: "desenvolvimento técnico: relações, fundamentos, consequências e aplicação ao caso",
      // Desenvolvimento é julgamento da IA, mas item exigido ausente limita a faixa.
      faixaPeloEspelho: (c) => (c.naoAtendidos >= 2 ? { teto: "D" } : c.naoAtendidos === 1 ? { teto: "C" } : null),
      faixas: [
        { codigo: "A", min: 9, max: 10, descritor: "todos os itens exigidos são DESENVOLVIDOS (explica relações, fundamentos, consequências ou aplicação ao caso narrado), não apenas mencionados" },
        { codigo: "B", min: 7, max: 8.5, descritor: "todos os itens exigidos presentes; 1 ou 2 apenas mencionados, ou sem aplicação ao caso narrado" },
        { codigo: "C", min: 5, max: 6.5, descritor: "metade ou mais dos itens apenas mencionada ou listada, ou 1 item exigido ausente" },
        { codigo: "D", min: 2.5, max: 4.5, descritor: "resposta predominantemente enumerativa, sem desenvolvimento, ou 2 ou mais itens exigidos ausentes" },
        { codigo: "E", min: 0, max: 2, descritor: "sem elaboração, ou com erro técnico central" },
      ],
    },
  ],
  // Edital 13.7.5: NQ = DQ − ((NE/TL) × 1); 13.7.6: NQ < 0 vira zero (aplicado em calcularNota).
  formulaTexto: "NQ = DQ − (NE / TL)",
  formula: ({ dq, ne, tl }) => dq - ne / tl,
  areas: AREAS,
  traduzirAreaAntiga: (codigo) => AREA_2016_PARA_2026[codigo] ?? null,
  sinonimosGraduacao: {
    "fisico": "1", "fisica": "1",
    "fono": "2", "fonoaudiologo": "2", "fonoaudiologa": "2",
    "veterinaria": "3", "veterinario": "3", "medico veterinario": "3", "medica veterinaria": "3",
    "dentista": "4", "odontologo": "4", "odontologa": "4", "cirurgiao dentista": "4", "cirurgia dentista": "4",
    "sistemas de informacao": "5", "ciencia de dados": "5", "computacao": "5", "ti": "5", "tecnologia da informacao": "5", "redes de computadores": "5", "engenharia de software": "5", "seguranca da informacao": "5",
    "biologia": "6", "biologo": "6", "biologa": "6", "biomedico": "6", "biomedica": "6",
    "quimico": "7", "quimica": "7", "engenheiro quimico": "7", "engenheira quimica": "7",
    "farmaceutico": "8", "farmaceutica": "8",
    "contabilidade": "9", "contador": "9", "contadora": "9", "ciencias contabeis": "9",
    "economia": "10", "economista": "10",
    "geologo": "11", "geologa": "11", "minas": "11",
    "civil": "12", "engenheiro civil": "12", "engenheira civil": "12", "eng civil": "12",
    "mecanica": "13", "mecatronica": "13", "engenheiro mecanico": "13", "engenheira mecanica": "13",
    "eletrica": "14", "eletronica": "14", "telecomunicacoes": "14", "telecom": "14", "engenheiro eletricista": "14", "engenheira eletricista": "14",
    "agronomia": "15", "agronomo": "15", "agronoma": "15", "florestal": "15", "cartografica": "15", "cartografia": "15",
    "medico": "16", "medica": "16",
  },
  banco: BANCO,
  exemploEspelhoOficial: PADRAO_COMUM,
  aviso: "Nota estimada pela rubrica didática da Mentoria Vestigium, no formato histórico do Edital nº 1/2016 (IADES). Não é nota oficial da banca nem regra confirmada do próximo edital.",
  promptSistema: (area) => {
    const legado = area ? LEGADO[area] ?? null : null;
    const blocoArea = !area || !AREAS[area]
      ? "\n\nÁrea de formação do aluno: não informada."
      : legado
        ? `\n\nÁrea de formação do aluno: Área ${area} — ${AREAS[area]}. Conteúdo de referência: Anexo I de 2016, código ${legado}.\n\n${CONTEUDO_AREA[legado]}`
        : `\n\nÁrea de formação do aluno: Área ${area} — ${AREAS[area]}. Esta área não existia no edital de 2016 e o conteúdo programático dela ainda não foi publicado: avalie pelo conhecimento técnico consolidado da formação, aplicado à perícia criminal, sem exigir além do nível do padrão IADES abaixo e sem inventar item de edital.`;
    return [
      INSTRUCOES,
      textoRubrica(perfilPcdf.criterios),
      `# METODOLOGIA DE CORREÇÃO (documento "Espelho de Correção Discursivas PCDF")\n\n${ESPELHO}`,
      `# CALIBRAÇÃO (uso interno — não cite as faixas ao aluno como se fossem oficiais)\n\n${CALIBRACAO}`,
      `# CONTEÚDO PROGRAMÁTICO DE REFERÊNCIA (Anexo I do Edital nº 1/2016)\n\n${CONTEUDO_GERAIS}${blocoArea}`,
      `# PADRÃO OFICIAL DE RESPOSTAS DA DISCURSIVA DE 2016 (IADES)

Use como régua do NÍVEL DE EXIGÊNCIA real da banca: ela cobrava os núcleos centrais do comando com precisão técnica, sem exigir detalhes além do que foi pedido. Não exija do aluno mais do que este padrão exigiria numa questão equivalente. Se a questão corrigida for uma destas de 2016, o padrão abaixo é o espelho oficial dela.

${legado ? PADRAO_AREA[legado] : PADRAO_COMUM}`,
    ].join("\n\n---\n\n");
  },
};
