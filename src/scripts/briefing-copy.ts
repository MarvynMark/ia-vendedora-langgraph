// Briefing de copy para os vídeos (VSL + "como funciona a mentoria").
//
// Junta as TRÊS fontes de voz do lead que existem hoje, porque nenhuma sozinha basta:
//   1. CSV da planilha de aplicação — tem 3x mais linhas que o banco e colunas que o banco
//      nunca guardou (Status do Lead, Motivo da não conversão, disposto a investir, UTMs).
//      O mapeamento pergunta->coluna de src/routes/aplicacao-mentoria.ts é por regex e
//      descarta silenciosamente o que não casa.
//   2. leads_formulario_mentoria — tem `diferenca_com_mentor`, que NÃO existe no CSV.
//   3. rag_documentos — conversas ganhas e objeções já estruturadas por ingest-conversas.ts.
//
// Não chama LLM de propósito: despeja material bruto organizado, a destilação é por leitura.
//
// Uso:
//   bun run briefing            # acha o CSV mais recente em ~/Downloads
//   bun run briefing <caminho-do-csv>
//
// Saída: output/briefing-copy-<data>/

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pool } from "../db/pool.ts";

function log(m: string) {
  console.log(`[briefing] ${m}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let campos: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charAt(i);
    if (aspas) {
      if (c === '"') {
        if (texto.charAt(i + 1) === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      campos.push(campo);
      campo = "";
    } else if (c === "\n") {
      campos.push(campo);
      linhas.push(campos);
      campos = [];
      campo = "";
    } else if (c !== "\r") campo += c;
  }
  if (campo !== "" || campos.length > 0) {
    campos.push(campo);
    linhas.push(campos);
  }
  return linhas;
}

function acharCSV(): string {
  const arg = process.argv[2];
  if (arg) {
    if (!existsSync(arg)) throw new Error(`CSV não encontrado: ${arg}`);
    return arg;
  }
  const dir = join(homedir(), "Downloads");
  // Ordena por data de modificação, não por nome: "(13)" vem antes de "(9)" alfabeticamente.
  const candidatos = readdirSync(dir)
    .filter((f) => /aplica.*mentoria.*vestigium.*\.csv$/i.test(f))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const ultimo = candidatos.at(-1)?.f;
  if (!ultimo) throw new Error(`Nenhum CSV de aplicação em ${dir}. Passe o caminho como argumento.`);
  return join(dir, ultimo);
}

// ─────────────────────────────────────────────────────────────────────────────
// Colunas por regex no cabeçalho (robusto a mudanças de ordem no formulário)
// ─────────────────────────────────────────────────────────────────────────────

const COLUNAS = {
  statusLead: /status do lead/i,
  motivoPerda: /motivo da n[ãa]o convers/i,
  dificuldade: /maior dificuldade/i,
  primeiroPasso: /primeiro passo/i,
  expectativa: /o que voc[êe] espera/i,
  planoB: /plano b\b/i,
  oQueFaltou: /o que.*faltou/i,
  nivel: /n[íi]vel de concurseiro/i,
  concurso: /foco de concurso/i,
  graduacao: /gradua[çc][ãa]o/i,
  dispostoInvestir: /disposto e teria condi/i,
  jaFoiAluno: /j[áa] foi ou [ée] aluno/i,
  utmSource: /^utm_source$/i,
} as const;

type NomeColuna = keyof typeof COLUNAS;

function indexar(cabecalho: string[]): Record<NomeColuna, number> {
  const idx = {} as Record<NomeColuna, number>;
  for (const [nome, re] of Object.entries(COLUNAS) as [NomeColuna, RegExp][]) {
    idx[nome] = cabecalho.findIndex((h) => re.test(h.trim()));
    if (idx[nome] === -1) log(`⚠️  coluna não encontrada no CSV: ${nome}`);
  }
  return idx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto
// ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set(
  ("a o e de da do que para com em no na os as um uma nao sim eu me meu minha mais muito por " +
    "se ao dos das como tem ter isso ja mas ou pra pro sou estou tenho ser meus minhas pois " +
    "essa esse este esta seu sua quando onde qual meu")
    .split(" "),
);

function semAcento(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function palavras(s: string): string[] {
  return (semAcento(s).match(/[a-z]{4,}/g) ?? []).filter((p) => !STOP.has(p));
}

function limpar(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Log-odds de cada termo entre dois grupos, para achar o vocabulário que separa. */
function lift(grupoA: string[], grupoB: string[], minOcorrencias = 12) {
  const contar = (textos: string[]) => {
    const c = new Map<string, number>();
    for (const t of textos) for (const p of new Set(palavras(t))) c.set(p, (c.get(p) ?? 0) + 1);
    return c;
  };
  const ca = contar(grupoA);
  const cb = contar(grupoB);
  const na = grupoA.length;
  const nb = grupoB.length;
  const res: { termo: string; razao: number; a: number; b: number }[] = [];
  for (const termo of new Set([...ca.keys(), ...cb.keys()])) {
    const a = ca.get(termo) ?? 0;
    const b = cb.get(termo) ?? 0;
    if (a + b < minOcorrencias) continue;
    const razao = ((a + 0.5) / (na + 0.5)) / ((b + 0.5) / (nb + 0.5));
    res.push({ termo, razao, a, b });
  }
  return res.sort((x, y) => y.razao - x.razao);
}

/** Respostas distintas e substanciais, priorizando as que contêm os termos-chave. */
function amostrar(textos: string[], termos: string[], limite = 25, minLen = 40): string[] {
  const vistos = new Set<string>();
  const comTermo: string[] = [];
  const resto: string[] = [];
  for (const t of textos) {
    const v = limpar(t);
    if (v.length < minLen) continue;
    const chave = semAcento(v).slice(0, 40);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const bate = termos.length === 0 || termos.some((termo) => semAcento(v).includes(termo));
    (bate ? comTermo : resto).push(v);
  }
  return [...comTermo, ...resto].slice(0, limite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Relatórios
// ─────────────────────────────────────────────────────────────────────────────

const CAMPOS_ABERTOS: { nome: NomeColuna; titulo: string; termos: string[] }[] = [
  { nome: "dificuldade", titulo: "Maior dificuldade de organização/planejamento", termos: ["eficien", "otimiz", "prioriz", "por onde"] },
  { nome: "oQueFaltou", titulo: "O que faltou para ser aprovado", termos: ["acredito", "organiza", "estrategia"] },
  { nome: "primeiroPasso", titulo: "O que fez dar o primeiro passo", termos: ["sozinh", "perdid"] },
  { nome: "expectativa", titulo: "O que espera da mentoria", termos: ["tempo", "foco", "metodo"] },
  { nome: "planoB", titulo: "Plano B", termos: [] },
];

function bloco01Frames(linhas: string[][], idx: Record<NomeColuna, number>): string {
  const val = (l: string[], c: NomeColuna) => (idx[c] >= 0 ? (l[idx[c]] ?? "").trim() : "");
  const rotulados = linhas.filter((l) => ["comprou", "perdido"].includes(val(l, "statusLead").toLowerCase()));
  const compradores = rotulados.filter((l) => val(l, "statusLead").toLowerCase() === "comprou");
  const perdidos = rotulados.filter((l) => val(l, "statusLead").toLowerCase() === "perdido");

  const out: string[] = [
    "# 01 — Frames: o que compradores escrevem e os perdidos não",
    "",
    `Base rotulada: **${rotulados.length}** de ${linhas.length} aplicações (${compradores.length} compraram, ${perdidos.length} perderam).`,
    "",
    "> ⚠️ A coluna *Status do Lead* só é preenchida para leads que um vendedor trabalhou.",
    "> As taxas aqui servem para **comparar perfis entre si**, nunca como taxa real do funil.",
    "",
  ];

  // Cruzamentos
  const cruzar = (c: NomeColuna, titulo: string, minN = 15) => {
    const mapa = new Map<string, [number, number]>();
    for (const l of rotulados) {
      const v = val(l, c);
      if (!v) continue;
      const par = mapa.get(v) ?? [0, 0];
      par[val(l, "statusLead").toLowerCase() === "comprou" ? 0 : 1]++;
      mapa.set(v, par);
    }
    const linhasTab = [...mapa.entries()]
      .map(([v, [a, b]]) => ({ v, a, b, n: a + b, tx: a / (a + b) }))
      .filter((x) => x.n >= minN)
      .sort((x, y) => y.tx - x.tx);
    if (linhasTab.length === 0) return;
    out.push(`## Conversão relativa por: ${titulo}`, "", "| valor | n | compras | taxa |", "|---|---|---|---|");
    for (const x of linhasTab) out.push(`| ${x.v} | ${x.n} | ${x.a} | ${(x.tx * 100).toFixed(1)}% |`);
    out.push("");
  };
  cruzar("dispostoInvestir", "disposto a investir ~R$ 250/mês");
  cruzar("nivel", "nível de concurseiro");
  cruzar("jaFoiAluno", "já é aluno do Walker");
  cruzar("utmSource", "utm_source", 5);

  // Vocabulário e frases por campo aberto
  for (const campo of CAMPOS_ABERTOS) {
    if (idx[campo.nome] < 0) continue;
    const txtC = compradores.map((l) => val(l, campo.nome)).filter(Boolean);
    const txtP = perdidos.map((l) => val(l, campo.nome)).filter(Boolean);
    const l1 = lift(txtC, txtP);
    out.push(`## ${campo.titulo}`, "", `Compradores n=${txtC.length} · perdidos n=${txtP.length}`, "");
    out.push("**Vocabulário mais forte em COMPRADORES:**", "");
    for (const t of l1.slice(0, 12)) out.push(`- \`${t.termo}\` — ${t.razao.toFixed(1)}× (${t.a} vs ${t.b})`);
    out.push("", "**Vocabulário mais forte em PERDIDOS:**", "");
    for (const t of l1.slice(-12).reverse()) out.push(`- \`${t.termo}\` — ${(1 / t.razao).toFixed(1)}× (${t.b} vs ${t.a})`);
    out.push("", "**Frases de COMPRADORES:**", "");
    for (const f of amostrar(txtC, campo.termos)) out.push(`> ${f}`, "");
    out.push("**Frases de PERDIDOS:**", "");
    for (const f of amostrar(txtP, [], 15)) out.push(`> ${f}`, "");
  }
  return out.join("\n");
}

async function bloco02Compradores(): Promise<string> {
  const r = await pool.query<{ titulo: string; conteudo: string }>(
    `SELECT titulo, conteudo FROM rag_documentos WHERE tipo = 'conversa_ganha' ORDER BY id`,
  );
  const out: string[] = [
    "# 02 — A voz de quem comprou",
    "",
    `${r.rowCount} conversas ganhas indexadas (rag_documentos, tipo \`conversa_ganha\`).`,
    "",
    "Só as falas do LEAD. O bloco FECHAMENTO da ingestão não serve para copy: numa conversa",
    "ganha as últimas mensagens já são matrícula, boleto e suporte, não a decisão. O que tem",
    "valor é o que o comprador escreveu ao longo da conversa.",
    "",
  ];
  const vistos = new Set<string>();
  const falas: string[] = [];
  for (const doc of r.rows) {
    // As falas vêm concatenadas como "LEAD: ... IA/VENDEDOR: ..." dentro dos blocos.
    for (const m of doc.conteudo.matchAll(/LEAD:\s*([\s\S]*?)(?=LEAD:|IA\/VENDEDOR:|\n[A-ZÇÃÕ ]+:|$)/g)) {
      const fala = limpar(m[1] ?? "");
      if (fala.length < 45) continue;
      const chave = semAcento(fala).slice(0, 45);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      falas.push(fala.slice(0, 400));
    }
  }
  out.push(`${falas.length} falas distintas e substanciais de compradores.`, "");
  for (const f of falas) out.push(`> ${f}`, "");
  return out.join("\n");
}

async function bloco03Objecoes(linhas: string[][], idx: Record<NomeColuna, number>): Promise<string> {
  const val = (l: string[], c: NomeColuna) => (idx[c] >= 0 ? (l[idx[c]] ?? "").trim() : "");
  const out: string[] = ["# 03 — Por que não fecham", ""];

  // Motivos rotulados pelo time (só existem no CSV)
  const motivos = new Map<string, number>();
  for (const l of linhas) {
    const v = val(l, "motivoPerda");
    if (v) motivos.set(v, (motivos.get(v) ?? 0) + 1);
  }
  const total = [...motivos.values()].reduce((a, b) => a + b, 0);
  out.push(`## Motivo da não conversão, rotulado pelo time (n=${total})`, "", "| motivo | n | % |", "|---|---|---|");
  for (const [m, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`| ${m} | ${n} | ${((n / total) * 100).toFixed(1)}% |`);
  }
  out.push("");

  // Objeções reais indexadas
  const r = await pool.query<{ titulo: string; conteudo: string; metadata: Record<string, unknown> }>(
    `SELECT titulo, conteudo, metadata FROM rag_documentos WHERE tipo = 'objecao' ORDER BY id`,
  );
  const reais = r.rows.filter((d) => d.metadata?.["origem"] !== "roteiro_prompt");
  out.push(`## Objeções reais de conversas perdidas (${reais.length} docs)`, "");
  for (const doc of reais) {
    out.push(`### ${doc.titulo}`, "", limpar(doc.conteudo).slice(0, 900), "");
  }
  return out.join("\n");
}

async function bloco04Banco(): Promise<string> {
  // diferenca_com_mentor não existe no CSV — só no banco.
  const r = await pool.query<{ diferenca_com_mentor: string }>(
    `SELECT diferenca_com_mentor FROM leads_formulario_mentoria
     WHERE diferenca_com_mentor IS NOT NULL AND length(diferenca_com_mentor) >= 40`,
  );
  const textos = r.rows.map((x) => x.diferenca_com_mentor);
  const out: string[] = [
    "# 04 — A transformação, nas palavras do lead",
    "",
    '"O que seria diferente se você tivesse um mentor?" — campo que existe só no banco',
    `(\`leads_formulario_mentoria.diferenca_com_mentor\`), ${textos.length} respostas substanciais.`,
    "",
    "É a descrição do resultado desejado pelo próprio lead: matéria-prima direta para a promessa da VSL.",
    "",
  ];
  for (const f of amostrar(textos, [], 60)) out.push(`> ${f}`, "");
  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const caminho = acharCSV();
  log(`CSV: ${caminho}`);
  const linhasCSV = parseCSV(readFileSync(caminho, "utf8"));
  const cabecalho = linhasCSV[0];
  if (!cabecalho) throw new Error("CSV vazio");
  const dados = linhasCSV.slice(1).filter((l) => l.some((c) => c.trim()));
  const idx = indexar(cabecalho);
  log(`${dados.length} aplicações no CSV, ${cabecalho.length} colunas`);

  const data = new Date().toISOString().slice(0, 10);
  const dir = `output/briefing-copy-${data}`;
  mkdirSync(dir, { recursive: true });

  const arquivos: [string, string][] = [
    ["01-frames.md", bloco01Frames(dados, idx)],
    ["02-compradores.md", await bloco02Compradores()],
    ["03-objecoes.md", await bloco03Objecoes(dados, idx)],
    ["04-transformacao.md", await bloco04Banco()],
  ];
  for (const [nome, conteudo] of arquivos) {
    writeFileSync(join(dir, nome), conteudo);
    log(`${nome} — ${(conteudo.length / 1024).toFixed(0)} KB`);
  }
  log(`pronto: ${dir}/`);
  await pool.end();
}

await main();
