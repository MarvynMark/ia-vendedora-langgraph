// Corrige uma resposta localmente, sem WhatsApp, e imprime exatamente o que o aluno receberia.
// Serve para calibrar o corretor com redações reais antes de abrir para os alunos.
//
//   bun run src/scripts/testar-corretor.ts --questao G01 --resposta resposta.txt
//   bun run src/scripts/testar-corretor.ts --questao E01 --area 103 --resposta folha1.jpg folha2.jpg
//   bun run src/scripts/testar-corretor.ts --enunciado "Explique..." --resposta prova.pdf
//
// Opções: --concurso (padrão pcdf), --area (código, ex.: 103), --questao (código do banco) ou
// --enunciado (texto), --resposta (um .txt, ou fotos/PDF manuscritos, em ordem), --vezes N (consistência).
import { readFileSync } from "node:fs";
import { buscarPerfil } from "../corretor/perfis/index.ts";
import { avaliarResposta, bytesParaConteudo, montarEspelhoPorMaioria, tipoPorExtensao, transcreverResposta } from "../corretor/ia.ts";
import { buscarQuestao, calcularNota, linhasConsideradas, linhasDeTextoDigitado, numerarLinhas } from "../corretor/regras.ts";
import { montarDevolutiva } from "../corretor/devolutiva.ts";

function argumentos(): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  let atual = "";
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--")) { atual = a.slice(2); r[atual] = []; }
    else r[atual]?.push(a);
  }
  return r;
}

const args = argumentos();
const perfil = buscarPerfil(args["concurso"]?.[0] ?? "pcdf");
if (!perfil) throw new Error("Concurso desconhecido");
const area = args["area"]?.[0] ?? null;
const codigo = args["questao"]?.[0]?.toUpperCase() ?? null;
const enunciado = codigo ? buscarQuestao(perfil, codigo, area)?.enunciado : args["enunciado"]?.join(" ");
if (!enunciado) throw new Error("Informe --questao (com --area para as específicas) ou --enunciado");
const arquivos = args["resposta"] ?? [];
if (!arquivos.length) throw new Error("Informe --resposta");

let linhas: string[];
let digitada = false;
let estimadas = false;
if (arquivos.length === 1 && arquivos[0]!.endsWith(".txt")) {
  ({ linhas, estimadas } = linhasDeTextoDigitado(readFileSync(arquivos[0]!, "utf-8"), perfil));
  digitada = true;
} else {
  const partes = arquivos.map((f, i) => bytesParaConteudo(new Uint8Array(readFileSync(f)), tipoPorExtensao(f), i));
  const t = await transcreverResposta(partes);
  linhas = t.linhas;
  console.log(`\n===== TRANSCRIÇÃO =====\n${numerarLinhas(linhas)}${t.aviso ? `\n⚠️ ${t.aviso}` : ""}`);
}

const { consideradas, descartadas } = linhasConsideradas(linhas, perfil, estimadas);
// --vezes N: corrige N vezes com o MESMO espelho, para medir a consistência da nota.
const vezes = Number(args["vezes"]?.[0] ?? "1");
const exigidos = await montarEspelhoPorMaioria(perfil, enunciado);
console.log(`\n===== ESPELHO EXIGIDO (montado só pelo enunciado) =====\n${exigidos.map((x, i) => `${i + 1}. ${x.elemento}\n   critério: ${x.atendidoSe}`).join("\n")}`);
console.log(`\n===== ENUNCIADO =====\n${enunciado}\n\n===== RESPOSTA (${linhas.length} linhas${estimadas ? ", estimadas" : ""}) =====\n${numerarLinhas(linhas)}`);

const inicio = Date.now();
const rodadas = await Promise.all(Array.from({ length: vezes }, () => avaliarResposta({
  perfil, area, enunciado, exigidos, linhas: consideradas, linhasDescartadas: descartadas,
  digitada, linhasEstimadas: estimadas, telefone: "teste-local",
})));
for (const [n, avaliacao] of rodadas.entries()) {
  const calculo = calcularNota(perfil, avaliacao, linhas, estimadas);
  const msgs = montarDevolutiva(perfil, avaliacao, calculo, { linhasEstimadas: estimadas, codigoQuestao: codigo });
  if (vezes > 1) {
    console.log(`\n##### RODADA ${n + 1}: NQ ${calculo.nq} | ${calculo.criterios.map((c) => `${c.sigla} ${c.nota} (${c.faixa?.codigo ?? "?"}${c.faixaAjustada ? "*" : ""})`).join(" · ")} | NE ${calculo.ne}`);
    console.log(avaliacao.espelho.map((e) => `   ${e.origem === "EXIGIDO" ? "E" : "+"} ${e.status.padEnd(12)} ${e.elemento.slice(0, 90)}`).join("\n"));
  }
  if (vezes === 1 || args["completo"]) for (const [i, msg] of msgs.entries()) console.log(`\n===== MENSAGEM ${i + 1} (${msg.length} caracteres) =====\n${msg}`);
}
console.log(`\n(${vezes} correção(ões) em ${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
process.exit(0);
