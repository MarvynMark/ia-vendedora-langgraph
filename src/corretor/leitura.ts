// Leitura do que o aluno mandou: resposta manuscrita (foto/PDF) linha a linha, enunciado em foto e
// ajustes da transcrição pedidos pelo aluno antes do CORRIGIR.
import { type Anexo, type ParteConteudo, anexoParaConteudo, chamarJson } from "./openai.ts";
import { numerarLinhas } from "./regras.ts";

const PROMPT_TRANSCRICAO = `Você transcreve respostas manuscritas de provas discursivas de concurso.

Regras:
- Transcreva EXATAMENTE o que o candidato escreveu, linha por linha da folha, na ordem das páginas recebidas.
- NÃO corrija nada: mantenha erros de grafia, acentuação, pontuação, concordância e as palavras partidas no fim da linha (com o hífen, se houver).
- Cada linha escrita da folha vira um item da lista "linhas". Linhas em branco no meio do texto podem ser omitidas.
- Não inclua a numeração impressa na folha, cabeçalhos, nomes de campos, carimbos ou o enunciado da questão: só o texto do candidato.
- Palavra que você não consegue ler com segurança vira [ilegível]. Nunca invente.
- Em "aviso", escreva em uma frase curta qualquer problema que o candidato precise saber (foto cortada, desfocada, página aparentemente faltando, o arquivo não parece uma resposta). Se não houver problema, deixe vazio.`;

/** Lê as fotos/PDFs da resposta e devolve as linhas exatamente como o aluno escreveu. */
export async function transcreverResposta(anexos: Anexo[] | ParteConteudo[]): Promise<{ linhas: string[]; aviso: string }> {
  const conteudo: ParteConteudo[] = [{ type: "text", text: `Transcreva a resposta manuscrita (${anexos.length} arquivo(s), em ordem).` }];
  for (const [i, a] of anexos.entries()) conteudo.push("type" in a ? a : await anexoParaConteudo(a, i));
  const r = await chamarJson<{ linhas: string[]; aviso: string }>(PROMPT_TRANSCRICAO, conteudo, "transcricao", {
    type: "object",
    properties: { linhas: { type: "array", items: { type: "string" } }, aviso: { type: "string" } },
    required: ["linhas", "aviso"],
    additionalProperties: false,
  });
  return { linhas: r.linhas.map((l) => l.trim()).filter(Boolean), aviso: r.aviso.trim() };
}

/** Lê o enunciado mandado em foto/PDF. */
export async function transcreverEnunciado(anexos: Anexo[]): Promise<string> {
  const conteudo: ParteConteudo[] = [{ type: "text", text: "Transcreva o enunciado (comando) da questão discursiva." }];
  for (const [i, a] of anexos.entries()) conteudo.push(await anexoParaConteudo(a, i));
  const r = await chamarJson<{ enunciado: string }>(
    "Você transcreve enunciados de questões de prova. Transcreva o comando completo da questão, com todos os subitens, sem resumir nem comentar. Se houver texto de apoio, inclua. Se não houver enunciado legível, devolva vazio.",
    conteudo,
    "enunciado",
    { type: "object", properties: { enunciado: { type: "string" } }, required: ["enunciado"], additionalProperties: false },
  );
  return r.enunciado.trim();
}

/** O aluno corrigiu a transcrição ("na linha 5 é perícia"): aplica só o que ele pediu. */
export async function ajustarTranscricao(linhas: string[], pedido: string): Promise<{ linhas: string[]; entendeu: boolean }> {
  const r = await chamarJson<{ linhas: string[]; entendeu: boolean }>(
    `Você mantém a transcrição de uma resposta manuscrita. O candidato está apontando o que ficou errado na transcrição.
Aplique SOMENTE as alterações que ele pediu, nas linhas indicadas, e devolva a transcrição completa, linha por linha, sem numeração.
Não corrija mais nada por conta própria: erros de português do candidato devem permanecer.
Se a mensagem dele não for um pedido de ajuste da transcrição, devolva as linhas sem mudança e entendeu = false.`,
    [{ type: "text", text: `TRANSCRIÇÃO ATUAL:\n${numerarLinhas(linhas)}\n\nMENSAGEM DO CANDIDATO:\n${pedido}` }],
    "ajuste_transcricao",
    {
      type: "object",
      properties: { linhas: { type: "array", items: { type: "string" } }, entendeu: { type: "boolean" } },
      required: ["linhas", "entendeu"],
      additionalProperties: false,
    },
  );
  return { linhas: r.linhas.map((l) => l.replace(/^\d{1,2}\.\s/, "").trim()).filter(Boolean), entendeu: r.entendeu };
}
