// Black estendida (12/11 a 30/11/2026). A Black Vestigium 2026 fechou em 11/11, 23h59. Até o fim
// de novembro a IA vende pelos preços dela, com a narrativa "a Black já encerrou, mas consegui te
// encaixar no valor dela".
//
// Decisões do Gusthavo (12/11):
//   - vale para TODO lead, na hora do preço: a tabela normal some do pitch até 30/11;
//   - entram o Anual com material, o Anual sem material, o Semestral e o Anual do Médico Legista;
//   - a IA manda o link da Black direto (as ofertas ficam ativas na Guru até 30/11);
//   - o "consegui te encaixar" vai na mesma resposta do preço, sem teatro de espera.
// Preços e links: tarefa "Fechar oferta, bônus e meta" (perito) e "Copys do grupo de legistas"
// (médico) no ClickUp, pasta BLACK 26 09/11.
//
// Módulo PURO de propósito: sem rede, para o bloco do prompt e as guardas serem testáveis.

import { instanteDeParedeSP } from "../config/agenda.ts";

export const BLACK_NOVEMBRO = {
  nome: "black_estendida_nov_2026",
  inicio: instanteDeParedeSP(2026, 10, 12, 0, 0),
  fim: instanteDeParedeSP(2026, 10, 30, 23, 59),
  links: {
    anualMaterial: "https://peritowalker.com.br/blackperitoanualestrategia",
    anual: "https://peritowalker.com.br/blackperitoanual",
    semestral: "https://peritowalker.com.br/blackperitosemestral",
    medicoAnual: "https://clkdmg.site/pay/black-1-ano-medico-legista-mentoria-vestigium",
  },
} as const;

export function blackNovembroAtiva(agora = new Date()): boolean {
  const t = agora.getTime();
  return t >= BLACK_NOVEMBRO.inicio.getTime() && t <= BLACK_NOVEMBRO.fim.getTime();
}

const L = BLACK_NOVEMBRO.links;

// Link da tabela normal → link da Black. Se o modelo escapar para um link de preço cheio, o lead
// ainda cai no checkout da Black do MESMO plano (ou do equivalente da Black, no Semestral). Só os
// de cartão: parcelado da Black não existe, e o Semestral do Médico Legista não entrou na Black.
const TROCA_DE_LINK: ReadonlyArray<[RegExp, string]> = [
  [/https?:\/\/peritowalker\.com\.br\/mentoriaperitoanualpremium(?![a-z0-9])/gi, L.anualMaterial],
  [/https?:\/\/peritowalker\.com\.br\/mentoriaperitoanual(?![a-z0-9])/gi, L.anual],
  [/https?:\/\/peritowalker\.com\.br\/mentoriaperitosemestralpremium1?(?![a-z0-9])/gi, L.semestral],
  [/https?:\/\/peritowalker\.com\.br\/mentoriaperito(?![a-z0-9])/gi, L.semestral],
  [/https?:\/\/peritowalker\.com\.br\/mentorialegistaanual(?![a-z0-9])/gi, L.medicoAnual],
];

/** Troca links de cartão da tabela normal pelos da Black. Devolve o texto e o que mudou. */
export function trocarLinksPelaBlack(texto: string): { texto: string; trocados: string[] } {
  let saida = texto ?? "";
  const trocados: string[] = [];
  for (const [re, destino] of TROCA_DE_LINK) {
    saida = saida.replace(re, (de) => {
      trocados.push(`${de} → ${destino}`);
      return destino;
    });
  }
  return { texto: saida, trocados };
}

const REGRAS_COMUNS = `
  **A NARRATIVA (uma vez por conversa, na primeira bolha em que o preço aparece):** a Black Vestigium
  encerrou no dia 11/11, mas você conseguiu encaixar o lead no valor dela. Na MESMA resposta do
  preço, sem pedir para ele esperar: 🚫 nada de "deixa eu ver se consigo", "vou verificar", "vou
  falar com o financeiro" ou "me dá uns minutinhos". Se ele perguntar até quando vale: "consigo
  segurar esse valor até o fim de novembro". Sem número de vagas, sem "últimas vagas" e sem
  inventar outro desconto em cima.
  > Lead que pergunta "a Black ainda tá valendo?" ou "perdi a Black": "A Black encerrou dia 11,
  > mas consigo te encaixar no valor dela." e siga o roteiro normal até o pitch (as descobertas
  > continuam valendo antes do preço).
  > Lead que JÁ ouviu o preço normal nesta conversa: na próxima vez que o preço vier, use a
  > narrativa e passe o valor da Black do mesmo plano, sem citar o valor antigo.

  **Pagamento:** os links da Black aceitam cartão (até 12x) e PIX à vista. 🚫 **Não existe boleto/PIX
  parcelado na Black:** NÃO mande nenhum link "parcelado" da seção PRODUTOS E LINKS (são do preço
  cheio). Se o lead não tem cartão ou limite: ofereça o PIX à vista; se ele precisar parcelar sem
  cartão, chame **Escalar_humano** com o resumo começando por "🖤 BLACK ESTENDIDA: quer parcelar
  sem cartão: [plano]" e diga que a equipe já te chama pra ver a melhor forma.
  **"Tem desconto?":** o valor da Black já é a condição; no PIX à vista fica no menor valor (passe o
  à vista do plano, nunca porcentagem).

  **Regras que continuam valendo:** só a parcela no pitch (o à vista só se ele perguntar), no máximo
  5 bolhas no pitch, sem travessão, garantia de 7 dias fora do pitch, nunca invente taxa e nunca
  diga que um edital saiu.
`;

/** Bloco do pitch para a trilha Perito, enquanto a Black estendida está ativa. */
export function blocoBlackNovembroPerito(): string {
  return `
# 🖤 BLACK ESTENDIDA (até 30/11): SUBSTITUI OS PREÇOS DO PITCH E DA TABELA

<black>
  Até 30/11 os preços dos planos abaixo NÃO são os da seção "PRODUTOS E LINKS" nem os escritos
  nas bolhas do PITCH DE PREÇO e nas objeções. Sempre que o roteiro mandar o Anual Completo, o
  Anual, o Semestral Premium ou o Semestral, use a versão da Black:

  | Plano da Black | 12x no cartão | PIX à vista | Link |
  |---|---|---|---|
  | Anual com material (mentoria + Premium do Estratégia) | 12x de R$ 315,38 | R$ 3.197 | ${L.anualMaterial} |
  | Anual (só a mentoria) | 12x de R$ 246,32 | R$ 2.497 | ${L.anual} |
  | Semestral (só a mentoria, SEM o material) | 12x de R$ 157,54 | R$ 1.597 | ${L.semestral} |

  Escreva a parcela COM os centavos, exatamente como na tabela.

  **O par do pitch (a descoberta de material continua decidindo):**
  - Lead **SEM material** → **Anual com material** (12x de R$ 315,38) + **Semestral** (12x de R$ 157,54).
    O Semestral da Black NÃO tem o Estratégia: diga isso na bolha dele, sem esconder.
  - Lead **COM material** → **Anual** (12x de R$ 246,32) + **Semestral** (12x de R$ 157,54).
  > Não existe Semestral Premium na Black. Não ofereça o Semestral Premium nem o Anual Completo do
  > preço cheio a ninguém até 30/11.

  **Bolhas do pitch na Black (troque as do PITCH DE PREÇO por estas):**
  - Bolha 1, sem material: "A nossa Black já encerrou, mas consegui te encaixar no valor dela. Pro seu momento, o plano que eu indico é o Anual com material: 12 meses comigo te acompanhando de perto, e ainda vem com a assinatura Premium do Estratégia, então você leva de bônus o melhor preparatório do Brasil."
  - Bolha 1, com material: "A nossa Black já encerrou, mas consegui te encaixar no valor dela. Pro seu momento, o plano que eu indico é o Anual: 12 meses comigo te acompanhando de perto até a prova do [concurso]."
  - Bolha 2: "Fica em 12x de R$ 315,38 no cartão." (sem material) / "Fica em 12x de R$ 246,32 no cartão." (com material)
  - Bolha 3, sem material: "Se preferir um prazo mais curto, tem o Semestral: a mesma mentoria em 6 meses, só que sem o material do Estratégia, em 12x de R$ 157,54."
  - Bolha 3, com material: "Se preferir um prazo mais curto, tem o Semestral: a mesma mentoria em 6 meses, em 12x de R$ 157,54."
  - Bolha 4: "Qual desses encaixa melhor pro seu momento, o Anual com material ou o Semestral?" (com material: "...o Anual ou o Semestral?")

  **O que vem junto (só se o lead perguntar o que está incluso):** no Anual, as duas versões, a
  mentoria de 12 meses, a plataforma de questões, os cursos de Criminalística, Medicina Legal e
  Genética Forense do IMLC, os resumos estratégicos e a correção de discursivas (sem citar
  quantidade); na versão com material, também a Premium do Estratégia. No Semestral: mentoria,
  plataforma de questões e correção de discursivas.

  **Objeção de preço / ORÇAMENTO DECLARADO na Black:** a escada é Anual com material 315,38 →
  Anual 246,32 (só se já tem material) → Semestral 157,54. Abaixo de R$ 157 por mês: "não agora",
  com retorno com DATA. O Trimestral segue a regra de sempre (só depois do Semestral recusado por
  preço), no preço normal.
${REGRAS_COMUNS}</black>
`;
}

/** Bloco do pitch para a trilha Médico Legista, enquanto a Black estendida está ativa. */
export function blocoBlackNovembroMedico(): string {
  return `
# 🖤 BLACK ESTENDIDA DO MÉDICO LEGISTA (até 30/11): SUBSTITUI O PLANO DO PITCH

<black>
  Até 30/11 o plano que você apresenta ao médico é o **Médico Legista Anual da Black**, no lugar
  do Médico Legista Semestral:

  | Plano | 12x no cartão | PIX à vista | Link |
  |---|---|---|---|
  | Médico Legista Anual (Black) | 12x de R$ 493 | R$ 4.997 | ${L.medicoAnual} |

  Inclui: 12 meses de mentoria com os mentores médicos e a Dra. Natália à frente, o material
  Premium do Estratégia Concursos, a plataforma de questões, o curso de Medicina Legal do IMLC e a
  correção de discursivas (sem citar quantidade).

  **Pitch (troque o do Médico Legista Semestral por este, 3 bolhas):**
  "A Black do Médico Legista já encerrou, [Dr(a). Nome], mas consegui te encaixar no valor dela. Com base no que você me falou, o plano que eu indico é o Anual da trilha Médico Legista: 12 meses de acompanhamento focado na sua formação, já com o material do Estratégia incluído."
  "Fica em 12x de R$ 493 no cartão."
  "Que tal começar por esse?"
  > Se ele hesitar no preço, pode usar a âncora UMA vez: fora da Black o Anual de legista custa
  > R$ 6.497, e na Black sai por R$ 4.997 à vista ou 12x de R$ 493.
  > Se ele quiser um prazo mais curto (prova próxima, internato): aí sim o **Médico Legista
  > Semestral** no preço normal (12x de R$ 394, link da seção PRODUTOS E LINKS). Nunca plano de
  > Perito Criminal, nunca Trimestral.
${REGRAS_COMUNS}</black>
`;
}

/** Lembrete curto no fim do prompt (perto dos dados do lead, onde o modelo dá mais peso). */
export function lembreteBlackNovembro(ehMedico: boolean): string {
  return ehMedico
    ? `  **🖤 BLACK ESTENDIDA ATÉ 30/11:** o plano do médico é o Médico Legista Anual da Black (12x de R$ 493, link ${L.medicoAnual}). Ver o bloco BLACK ESTENDIDA.\n`
    : `  **🖤 BLACK ESTENDIDA ATÉ 30/11:** os preços e links do pitch são os da Black (Anual com material 12x de R$ 315,38, Anual 12x de R$ 246,32, Semestral 12x de R$ 157,54), nunca os da tabela normal. Sem link parcelado. Ver o bloco BLACK ESTENDIDA.\n`;
}
