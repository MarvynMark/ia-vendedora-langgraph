// TRAVA DO ECO — impede a resposta-de-duas-palavras a uma fala substantiva do lead.
//
// Diagnóstico de agosto: das 72 falas do lead com 60+ caracteres, 61 (85%) receberam uma resposta
// que não tocava em nada do que ele disse. Os casos reais:
//
//   LEAD  Posso dar uma resposta mais assertiva amanhã? Vou verificar se a minha mãe pode me ajudar
//   IA    Claro, Ana!
//
//   LEAD  Eu quero sim fazer o curso, é ótimo. Mas não será possível fazer por enquanto
//   IA    Tranquilo, Andreia
//
// O prompt manda espelhar a fala, e o modelo não espelha. Aqui a regra é verificável: se o lead
// escreveu bastante e a resposta é curta E não reaproveita nenhuma palavra de conteúdo dele,
// o turno volta para o agente reescrever em vez de ir para o WhatsApp.

/** Palavras que aparecem em qualquer conversa deste funil — reaproveitá-las não é eco. */
const GENERICAS = new Set([
  "porque", "quando", "mentoria", "concurso", "estudar", "estudos", "estudo", "muito", "tempo",
  "gente", "assim", "preciso", "consigo", "estou", "tenho", "fazer", "ainda", "sobre", "perito",
  "criminal", "voce", "você", "agora", "sempre", "melhor", "gostaria", "queria", "poderia",
  "plano", "valor", "mesmo", "tudo", "coisa", "pouco", "achei", "acho",
]);

const normalizar = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Fatos de conteúdo que o lead deu: palavras de 5+ letras que não são genéricas do funil, MAIS os
 * números — data ("dia 10"), carga horária ("12h"), valor. Número é o fato mais concreto que
 * aparece numa fala, e devolvê-lo é a forma mais forte de eco ("fechado, dia 10 então").
 */
export function palavrasDeConteudo(texto: string): string[] {
  const t = normalizar(texto);
  const palavras = (t.match(/[a-z]{5,}/g) ?? []).filter((p) => !GENERICAS.has(p));
  const numeros = t.match(/\d+/g) ?? [];
  return [...new Set([...numeros, ...palavras])];
}

/** A resposta reaproveita alguma palavra de conteúdo da fala do lead? */
export function temEco(falaDoLead: string, resposta: string): boolean {
  const alvo = normalizar(resposta);
  return palavrasDeConteudo(falaDoLead).some((p) => alvo.includes(p));
}

// Abaixo disto a fala do lead é curta demais para exigir eco ("ok", "sim", "pode sim").
const MIN_FALA_LEAD = 60;
// Acima disto a resposta já tem conteúdo próprio suficiente, mesmo sem repetir palavra dele.
const MIN_RESPOSTA_LONGA = 180;

/**
 * True quando a resposta ignora uma fala substantiva do lead — o turno precisa ser reescrito.
 * Só acusa no caso claro: lead escreveu bastante, resposta é curta e não devolve nada dele.
 */
export function respostaIgnoraOLead(falaDoLead: string, resposta: string): boolean {
  const fala = (falaDoLead ?? "").trim();
  const resp = (resposta ?? "").trim();
  if (fala.length < MIN_FALA_LEAD) return false;
  if (resp.length >= MIN_RESPOSTA_LONGA) return false;
  if (!resp) return false;
  return !temEco(fala, resp);
}

/** Instrução devolvida ao agente quando a trava dispara. */
export function instrucaoReescrita(falaDoLead: string, jaEnviado = ""): string {
  const p = palavrasDeConteudo(falaDoLead).slice(0, 4);
  // O que as tools de mídia já mandaram neste turno JÁ chegou no WhatsApp. A reescrita entra DEPOIS
  // dele, então precisa saber disso — senão o lead lê "Entendo, Joel" seguido de "Entendi, Joel"
  // dizendo a mesma coisa (conv 6948).
  const contexto = jaEnviado.trim()
    ? ` Você já mandou isto ao lead agora há pouco, não repita nem recomece a saudação: "${jaEnviado.trim().slice(0, 300)}".`
    : "";
  return (
    "[SISTEMA: sua resposta ignorou o que o lead acabou de dizer. Ele escreveu algo com conteúdo real" +
    (p.length ? ` (falou de: ${p.join(", ")})` : "") +
    ". Reescreva devolvendo o fato mais concreto da fala dele — a pessoa, a data, o obstáculo, a " +
    "rotina — com a palavra dele, e só então siga. Não responda com 'claro', 'tranquilo' ou " +
    "'perfeito' sozinhos." + contexto + "]"
  );
}
