// Roteiro de áudio de boas-vindas a partir do formulário "Diagnóstico Inicial – Vestigium"
// (Respondi). O webhook recebe as respostas, a IA escreve o roteiro e o texto vai pelo WhatsApp
// para quem grava o áudio (o Walker; em teste, o Gusthavo).
//
// As perguntas NÃO são mapeadas uma a uma: o formulário tem 39 e é reescrito com frequência
// (ver o histórico de CAMPO_PADROES em routes/aplicacao-mentoria.ts). Todas as respostas vão
// para a IA como "pergunta: resposta" e o prompt diz o que usar. Só nome e WhatsApp são extraídos
// aqui, porque entram no cabeçalho do roteiro, que não pode depender da IA.

export type Respostas = Array<{ pergunta: string; resposta: string }>;

// Chaves de metadado que alguns formulários mandam junto das respostas e não são perguntas.
const CHAVES_IGNORADAS = /^(id|_?id|form_?id|form_?name|respondent_?id|date|created_?at|updated_?at|status|score|token|ip|user_?agent|utm_.*|_etiquetas)$/i;

function textoDe(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor === "string") return valor.trim() || null;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (Array.isArray(valor)) {
    const partes = valor.map(textoDe).filter((v): v is string => !!v);
    return partes.length ? partes.join(", ") : null;
  }
  return null;
}

/**
 * Extrai os pares pergunta/resposta do corpo do webhook, venha no formato que vier:
 * - plano, `{ "Pergunta": "resposta" }` (como o n8n repassa o formulário de aplicação);
 * - Respondi, em `respondent.answers` (o `raw_answers` do mesmo envio é ignorado);
 * - aninhado, com as respostas num objeto `answers`/`respostas` em qualquer nível;
 * - lista de itens `{ question|title|pergunta|label, answer|value|resposta }`.
 * Resposta em lista (múltipla escolha) vira texto separado por vírgula.
 */
export function extrairRespostas(body: unknown): Respostas {
  // Respondi: `respondent.answers` já vem como { título: resposta }. O mesmo envio traz
  // `raw_answers` com IDs e tipos de pergunta, que só poluiriam a entrada da IA.
  const respondi = (body as { respondent?: { answers?: unknown } } | null)?.respondent?.answers;
  if (respondi && typeof respondi === "object" && !Array.isArray(respondi)) body = respondi;

  const saida: Respostas = [];
  const vistas = new Set<string>();
  const adicionar = (pergunta: string, resposta: string | null) => {
    const p = pergunta.trim();
    if (!p || !resposta || CHAVES_IGNORADAS.test(p) || vistas.has(p)) return;
    vistas.add(p);
    saida.push({ pergunta: p, resposta });
  };

  const visitar = (no: unknown, chave: string | null) => {
    if (no == null) return;
    if (Array.isArray(no)) {
      const ehListaDeItens = no.some(i => i && typeof i === "object" && !Array.isArray(i));
      if (!ehListaDeItens) {
        if (chave) adicionar(chave, textoDe(no));
        return;
      }
      for (const item of no) visitar(item, chave);
      return;
    }
    if (typeof no === "object") {
      const o = no as Record<string, unknown>;
      const pergunta = textoDe(o.question ?? o.title ?? o.pergunta ?? o.label ?? o.question_title);
      const temResposta = ["answer", "value", "resposta", "answers"].some(k => k in o);
      const valor = o.answer ?? o.value ?? o.resposta ?? o.answers;
      if (pergunta && temResposta && (typeof valor !== "object" || valor === null || Array.isArray(valor))) {
        adicionar(pergunta, textoDe(valor));
        return;
      }
      for (const [k, v] of Object.entries(o)) visitar(v, k);
      return;
    }
    if (chave) adicionar(chave, textoDe(no));
  };

  visitar(body, null);
  return saida;
}

function respostaPorPergunta(respostas: Respostas, re: RegExp): string | null {
  return respostas.find(r => re.test(r.pergunta))?.resposta ?? null;
}

export function nomeDoAluno(respostas: Respostas): string | null {
  return respostaPorPergunta(respostas, /nome/i);
}

/** WhatsApp do aluno em +55DDDNÚMERO; null se não houver número reconhecível. */
export function whatsappDoAluno(respostas: Respostas): string | null {
  const bruto = respostaPorPergunta(respostas, /whats|celular|telefone/i);
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return `+${digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`}`;
}

/** "1min04s" a 2,6 palavras por segundo, o ritmo de fala do roteiro. */
export function duracaoEstimada(roteiro: string): string {
  const palavras = roteiro.trim().split(/\s+/).filter(Boolean).length;
  const segundos = Math.round(palavras / 2.6);
  return `${Math.floor(segundos / 60)}min${String(segundos % 60).padStart(2, "0")}s`;
}

// Trechos fixos, escritos pelo Walker (06/10/2026). A IA copia como estão: não pode inventar
// número de aprovados nem trajetória.
export const AUTORIDADE_WALKER =
  "A Mentoria Vestigium é sustentada em pilares da Ciência da Aprendizagem. Eu já fui aprovado em seis concursos e sei bem o caminho para a aprovação. Já aprovamos centenas de alunos para Perito Criminal e temos aprovados em todos os concursos de perito do Brasil.";
export const BORDAO_WALKER = "Pode confiar, vamos trabalhar juntos que vai dar certo.";

export const PROMPT_ROTEIRO = `Você é o assistente do Perito Walker, Perito Criminal e fundador da Mentoria Vestigium. Sua tarefa é escrever um ROTEIRO DE ÁUDIO de boas-vindas que o Walker vai gravar e enviar pelo WhatsApp para um novo aluno, com base nas respostas do formulário de diagnóstico.

Você vai receber TODAS as respostas do formulário no formato "pergunta: resposta". Use só estas informações: nome, formação, concursos que pensa em prestar e o concurso FOCO de hoje (o prioritário), o que mais atrapalha a constância, disciplinas com facilidade e com dificuldade, tempo de estudo, como revisa o conteúdo, o propósito/motivo para ser aprovado, como organiza os estudos e o desempenho em simulados. Ignore o resto.

## FORMATO DE SAÍDA (exatamente assim, nada antes nem depois)
CONCURSO: [concurso prioritário padronizado em MAIÚSCULAS, ex.: PCI-SC, PF, POLITEC-MT; se não houver, NÃO INFORMADO]

[roteiro em um único parágrafo]

## ESTRUTURA DO ROTEIRO (nesta ordem, um único parágrafo corrido)
1. ABERTURA: "[Primeiro nome], seja bem-vindo(a) à Mentoria Vestigium." Em seguida, avise que este número é pessoal e exclusivo da Mentoria e que qualquer dúvida pode ser trazida direto por aqui. Use o gênero correto conforme o nome.

2. PROPÓSITO: Retome o motivo que o aluno escreveu, parafraseado na 2ª pessoa ("Você mencionou que busca..."). Não copie literalmente, não corrija e não exagere. Feche validando em uma frase: é um motivo forte e legítimo, que vai mantê-lo(a) firme quando a motivação estiver baixa.

3. PERFIL ACADÊMICO: Conecte a formação às disciplinas de facilidade e trate-as como um ativo ("...é um ativo poderoso"). Se a formação tiver relação direta com a área pericial (Farmácia, Química, Biologia, Medicina, Odontologia, Engenharias, Física, TI), destaque essa vantagem. Depois cite as disciplinas de dificuldade como "áreas que vamos trabalhar com foco e técnica". Agrupe matérias quando fizer sentido (ex.: "os Direitos").

4. DIAGNÓSTICO DA REVISÃO (o centro do roteiro): Comente o método de revisão que o aluno informou e ligue-o diretamente ao obstáculo de constância que ele marcou. Seja honesto, mas nunca julgador. Use a lógica abaixo:
   - Releio o PDF / Assisto à aula novamente: dá falsa sensação de domínio, mas não fixa o conteúdo.
   - Releio ou assisto e depois faço questões: o caminho é bom, mas reler antes de testar consome tempo e mascara o que de fato ainda não foi aprendido.
   - Vou direto para questões: ótimo instinto, porque testar é a forma mais eficiente de aprender. Falta só organizar os intervalos.
   - Questões e flashcards: excelente base. Agora é colocar isso dentro de um cronograma de revisões espaçadas.
   - Não sei revisar: normalize ("a maioria nunca aprendeu a revisar") e diga que isso é exatamente o que a mentoria vai ensinar.
   Ligue ao obstáculo: ansiedade/insegurança → "isso pode alimentar sua ansiedade"; esquecimento rápido → "é exatamente por isso que o conteúdo escapa"; falta de tempo → "você gasta o pouco tempo que tem no que menos retém"; procrastinação/falta de motivação/concentração → "sem ver evolução, a motivação cai"; um misto → combine os dois efeitos principais.
   Feche com a solução: "Vamos estruturar sua revisão com intervalos planejados para transformar esse conhecimento em memória de longo prazo e dar regularidade ao seu aprendizado."

5. AUTORIDADE (texto fixo, copie exatamente): "${AUTORIDADE_WALKER}"

6. FECHAMENTO (texto fixo, copie exatamente): "${BORDAO_WALKER} Você agora faz parte da família Vestigium. Bora."

## REGRAS DE ESTILO
- Escrito para ser FALADO: frases curtas e diretas, tom de mentor próximo, firme e acolhedor. Use "você" e "pra".
- Entre 170 e 210 palavras no roteiro, para dar cerca de 1 minuto e 15 segundos de áudio.
- Um único parágrafo, sem tópicos, emojis, hashtags, aspas ou abreviações difíceis de ler em voz alta (escreva "Raciocínio Lógico", não "RLM").
- Use só o primeiro nome do aluno, e apenas uma vez, na abertura.
- NÃO mencione idade, filhos, rotina de trabalho, sono, estresse nem dados pessoais sensíveis. NÃO invente informações que o aluno não deu.
- Se uma informação não veio ou não faz sentido, pule o trecho correspondente sem comentar a ausência.
- Corrija a grafia de siglas e nomes de concursos (prf → PRF, pci sc → PCI-SC).`;

export function montarEntradaIA(respostas: Respostas): string {
  return respostas.map(r => `${r.pergunta}: ${r.resposta}`).join("\n");
}

/** Separa a linha "CONCURSO: X" do roteiro devolvido pela IA. */
export function separarSaidaIA(texto: string): { concurso: string; roteiro: string } {
  const limpo = texto.trim();
  const m = limpo.match(/^CONCURSO:\s*(.+)$/im);
  const concurso = m?.[1]?.trim() || "NÃO INFORMADO";
  const roteiro = (m ? limpo.replace(m[0], "") : limpo).trim().replace(/\s*\n+\s*/g, " ");
  return { concurso, roteiro };
}

export function montarMensagemRoteiro(opts: {
  nome: string;
  concurso: string;
  whatsapp: string | null;
  roteiro: string;
}): string {
  return [
    `Roteiro de boas-vindas: ${opts.nome}`,
    `Concurso prioritário: ${opts.concurso}`,
    `WhatsApp do aluno: ${opts.whatsapp ?? "não informado"}`,
    `Duração estimada: ${duracaoEstimada(opts.roteiro)}`,
    "",
    opts.roteiro,
  ].join("\n");
}
