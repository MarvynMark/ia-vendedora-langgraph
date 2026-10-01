// Prova social pela graduação do lead (decisão do Gusthavo, 01/10/2026).
//
// A concorrente (Excelere) cita aprovados com a formação de quem está do outro lado ("Perito
// Clélio, farmacêutico, 1º lugar"). O nosso "93% no RS" é forte, mas genérico: a farmacêutica
// ouve muito mais "uma farmacêutica como você passou" e vê o print.
//
// Cada caso tem FONTE: o print original está no Drive / na pasta [MENTORIA - VESTIGIUM]/aprovados,
// e a formação veio da ficha do aluno ou do Gusthavo. A cópia que a IA envia fica no MinIO
// (Vestigium/prova-social/), não no repositório: o repo é público e os prints mostram nome e
// conversa dos alunos. A legenda é escrita por nós, nunca pelo modelo — é ela que carrega o fato
// (nome, formação, resultado), e fato inventado em prova social destrói a confiança.

import { normalizar } from "./similaridade.ts";

const BASE = "https://s3.stkd.site/arquivosclientes/Vestigium/prova-social";

export interface CasoAprovado {
  id: string;
  /** Casa com a graduação do lead (texto normalizado: minúsculo e sem acento). null = só entra no sorteio geral. */
  formacao: RegExp | null;
  /** O que o Walker escreve antes dos prints quando a graduação BATE (pode dizer "como você"). */
  legenda: string;
  /**
   * O resultado sem falar de graduação ("o Pedro, aprovado e já nomeado perito em Goiás"), usado no
   * sorteio de quem não tem caso da própria área. Sem este campo, o caso não entra no sorteio.
   */
  resultado?: string;
  /** URLs públicas dos prints no MinIO, na ordem de envio (1 ou 2). A primeira é a do sorteio. */
  urls: readonly string[];
}

const VET = /veterin|med vet|\bvet\b/;
const MEDICINA = /\bmedic/;

// Autorizados pelo Gusthavo em 01/10/2026. A ordem importa: a primeira graduação que casar vence,
// então Veterinária vem antes de Medicina. Casos com a MESMA regex se alternam por conversa.
// Médicos ficam fora do sorteio geral (sem `resultado`): o cargo deles é de médico legista, e isso
// não serve de espelho pra quem é de biologia ou direito.
export const CASOS_APROVADOS: readonly CasoAprovado[] = [
  {
    id: "beatriz-fernanda-medvet",
    formacao: VET,
    legenda: "Olha a Beatriz e a Fernanda, veterinárias como você, no resultado da PCI-SC, a Beatriz em 6º lugar.",
    resultado: "a Beatriz, 6º lugar na PCI-SC",
    urls: [`${BASE}/beatriz-medvet.jpg`, `${BASE}/medvet-lista-pcisc.jpg`],
  },
  {
    id: "vitor-medicina",
    formacao: MEDICINA,
    legenda: "Esse é o Vítor, médico como você, 1º lugar na PCI-SC em Balneário Camboriú, junto com o Admir, também da mentoria.",
    urls: [`${BASE}/vitor-medicina.jpg`, `${BASE}/medicina-lista-pcisc.jpg`],
  },
  {
    id: "natalia-medicina",
    formacao: MEDICINA,
    legenda: "Essa é a Dra. Natália, médica como você, aprovada em 3 concursos de médico legista e que hoje está à frente dos médicos da mentoria.",
    urls: [`${BASE}/natalia-medicina.jpg`],
  },
  {
    id: "najla-farmacia",
    formacao: /farmac/,
    legenda: "Essa é a Najla, farmacêutica como você, no dia em que viu o nome dela na lista.",
    resultado: "a Najla, que viu o nome dela na lista de aprovados",
    urls: [`${BASE}/najla-farmacia.jpg`],
  },
  {
    id: "gusthavo-computacao",
    formacao: /comput|informat|sistemas|software|tecnologia da informacao|\bti\b|\bads\b/,
    legenda: "Esse é o Gusthavo, da computação como você, aprovado pra perito em Goiás com menos de 6 meses de estudo.",
    resultado: "o Gusthavo, aprovado pra perito em Goiás com menos de 6 meses de estudo",
    urls: [`${BASE}/gusthavo-computacao.jpg`],
  },
  {
    id: "pedro-quimica",
    formacao: /quimic/,
    legenda: "Esse é o Pedro, da química como você, aprovado e já nomeado perito criminal em Goiás.",
    resultado: "o Pedro, aprovado e já nomeado perito criminal em Goiás",
    urls: [`${BASE}/pedro-quimica.jpg`],
  },
  {
    id: "thaynara",
    formacao: null,
    legenda: "",
    resultado: "a Thaynara, 2º lugar no primeiro concurso de perito, com 2 meses e meio de estudo e trabalhando 44 horas por semana",
    urls: [`${BASE}/thaynara-geral.jpg`],
  },
  {
    id: "rafael",
    formacao: null,
    legenda: "",
    resultado: "o Rafael, 1º lugar na área dele",
    urls: [`${BASE}/rafael-geral.jpg`],
  },
];

/**
 * O caso da mesma graduação do lead (havendo mais de um, `semente` — o id da conversa — escolhe,
 * sempre o mesmo pra mesma conversa). Sem caso da área ou sem graduação conhecida, sorteia DOIS
 * alunos pela semente e monta uma legenda só com o resultado deles, sem falar de graduação.
 */
export function escolherCaso(
  formacao: string | null | undefined,
  semente: string | number = 0,
  casos: readonly CasoAprovado[] = CASOS_APROVADOS,
): CasoAprovado | null {
  const f = normalizar(formacao ?? "");
  const n = Number(String(semente).replace(/\D/g, "")) || 0;

  const primeiro = f ? casos.find((c) => c.formacao?.test(f)) : undefined;
  if (primeiro) {
    const grupo = casos.filter((c) => c.formacao?.source === primeiro.formacao!.source);
    return grupo[n % grupo.length]!;
  }

  const sorteio = casos.filter((c) => c.resultado);
  if (sorteio.length === 0) return null;
  if (sorteio.length === 1) {
    const a = sorteio[0]!;
    return { id: `geral-${a.id}`, formacao: null, legenda: `Olha ${a.resultado}.`, urls: [a.urls[0]!] };
  }
  // Dois distintos e estáveis por conversa: i pela semente, j "pula" um passo que também varia.
  const i = n % sorteio.length;
  const j = (i + 1 + (Math.floor(n / sorteio.length) % (sorteio.length - 1))) % sorteio.length;
  const [a, b] = [sorteio[i]!, sorteio[j]!];
  return {
    id: `geral-${a.id}-${b.id}`,
    formacao: null,
    legenda: `Olha dois alunos meus: ${a.resultado}, e ${b.resultado}.`,
    urls: [a.urls[0]!, b.urls[0]!],
  };
}
