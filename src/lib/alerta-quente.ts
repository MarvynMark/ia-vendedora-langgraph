import { classificarObjecao } from "./objecoes.ts";
import { temLinkDePagamento, temPrecoDePlano } from "./planos.ts";

// Barreira em código do Alertar_gestor ("⭐ Lead quente" no grupo do comercial).
//
// Diagnóstico de 25/10: dos 29 alertas em 14 dias, ~15 eram falsos, e o prompt já proibia todos.
// Três padrões:
//   A. "Tô pronta pra começar" (convs 10966, 10635, 10574, 289, 10399...): o lead responde à
//      pergunta de fechamento, a IA apresenta o preço e alerta "vai pagar agora" NO MESMO TURNO —
//      o lead nem viu o valor (a Janaina respondeu "não teria um mais em conta?" e "até 100$").
//   B. Decisão/preço com data (convs 10902, 10605, 10835, 10683): o motivo vinha copiado do
//      exemplo do retomarContexto — "vai decidir na próxima semana, travou no valor do Anual".
//   C. Só pediu informação (conv 10913).
//
// Função PURA e sem I/O, mesmo motivo de objecoes.ts: é a regra que decide se o time é
// interrompido, então precisa ser testável e re-executável contra os alertas reais.

export interface EntradaAlertaQuente {
  /** Falas da IA dos turnos ANTERIORES (o histórico só grava o turno atual depois do agente). */
  falasIaAnteriores: readonly string[];
  /** O que o lead mandou neste turno. */
  ultimaMensagem: string;
  /** Motivo que o modelo escreveu na chamada da ferramenta. */
  motivo: string;
}

export type DecisaoAlertaQuente =
  | { enviar: true }
  | { enviar: false; razao: "sem_preco_antes" | "objecao_preco" | "motivo_de_decisao" };

function normalizar(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// O lead falando de PAGAMENTO com todas as letras: dispensa a exigência de preço anterior (quem já
// sabe o valor e abre com "manda o link que eu pago" não precisa ouvir o pitch de novo).
const PAGAMENTO_EXPLICITO =
  /\b(comprovante|paguei|ja paguei|fiz o pix|pix feito|ja fiz o pagamento|(manda|me manda|envia|gera|pode gerar|pode mandar)( o| um)? link|vou pagar|quero pagar|pago (hoje|agora|amanha|dia))\b/;

// Motivo que descreve DECISÃO, preço travado ou curiosidade — o que a régua do prompt exclui.
const MOTIVO_DE_DECISAO =
  /\b(decidir|decisao|pensar|analisar|avaliar|travou no (valor|preco)|achou caro|(se )?programar financeiramente|se organizar|interessad[oa]|quer saber|informac|consideran)/;

export function avaliarAlertaQuente(e: EntradaAlertaQuente): DecisaoAlertaQuente {
  const fala = normalizar(e.ultimaMensagem);

  if (classificarObjecao(e.ultimaMensagem) === "preco") return { enviar: false, razao: "objecao_preco" };
  if (MOTIVO_DE_DECISAO.test(normalizar(e.motivo))) return { enviar: false, razao: "motivo_de_decisao" };

  const jaViuPreco = e.falasIaAnteriores.some((f) => temPrecoDePlano(f) || temLinkDePagamento(f));
  if (!jaViuPreco && !PAGAMENTO_EXPLICITO.test(fala)) return { enviar: false, razao: "sem_preco_antes" };

  return { enviar: true };
}
