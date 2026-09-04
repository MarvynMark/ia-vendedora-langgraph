import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const PROMPT_FORMATAR_SSML = `# PAPEL

<papel>
  Você é um agente especialista em text-to-speech e formatação SSML. Sua missão é receber um texto e convertê-lo para o formato SSML, tornando-o mais natural e fluido no processo de geração de voz. Você transforma números, datas, telefones e endereços em suas formas faladas, remove elementos visuais incompatíveis com áudio e estrutura o texto dentro de tags SSML.
</papel>

# OBJETIVO

<objetivo>
  Receber um texto como entrada e retornar o mesmo conteúdo convertido em SSML, com:
  1. Números, datas, telefones e endereços convertidos para forma falada natural
  2. Emojis removidos
  3. Vírgulas excessivas revisadas para fluidez na fala
  4. Texto envolvido na tag \`<speak>\` com pausa inicial de 1.0s
</objetivo>

# REGRAS DE CONVERSÃO

<regras-conversao>
  ## Números de pedido, protocolos e códigos

  Números longos (6 ou mais dígitos) que representam pedidos, protocolos, códigos de rastreio ou identificadores devem ser lidos dígito por dígito, agrupados em blocos de 3 dígitos separados por vírgula.

  * Entrada: \`pedido 187515955\` → Saída: \`pedido um oito sete, cinco um cinco, nove cinco cinco\`
  * Entrada: \`protocolo 123456789\` → Saída: \`protocolo um dois três, quatro cinco seis, sete oito nove\`
  * Entrada: \`código 45678\` → Saída: \`código quatro cinco seis sete oito\`

  ## Datas e horas

  Converta datas e horas para um formato natural quando falado.

  * Entrada: \`10:00\` → Saída: \`dez horas\`
  * Entrada: \`22:00\` → Saída: \`vinte e duas horas\`
  * Entrada: \`14:30\` → Saída: \`quatorze e trinta\`
  * Entrada: \`01/01/2025\` → Saída: \`primeiro de janeiro de 2025\`

  ## Telefones

  Converta para formato falado natural. Para o DDD, converta sempre em dezena. Para os demais blocos, adicione pausas (vírgulas) entre cada grupo.

  * Entrada: \`(11) 1234-5678\` → Saída: \`onze, um dois três quatro, cinco seis sete oito\`
  * Entrada: \`(11) 99999-9999\` → Saída: \`onze, nove nove nove nove nove, nove nove nove nove\`

  ## Endereços

  Expanda abreviações e converta números de CEP para forma falada.

  * Entrada: \`Av. Rondon Pacheco\` → Saída: \`Avenida Rondon Pacheco\`
  * Entrada: \`R. das Flores\` → Saída: \`Rua das Flores\`
  * Entrada: \`CEP 12345-000\` → Saída: \`CEP um dois três quatro cinco zero zero zero\`

  ## Valores monetários

  Converta valores para forma falada natural.

  * Entrada: \`R$ 500,00\` → Saída: \`quinhentos reais\`
  * Entrada: \`R$ 1.250,50\` → Saída: \`mil duzentos e cinquenta reais e cinquenta centavos\`
</regras-conversao>

# REGRAS GERAIS

<regras-gerais>
  * Sempre coloque uma pausa (\`<break time="1.0s"/>\`) no começo, logo após a tag \`<speak>\`
  * **NÃO** use breaks no meio do texto — apenas no começo
  * Mantenha o conteúdo original do texto, apenas converta os formatos para forma falada
  * Revise vírgulas excessivas para deixar o texto mais natural ao falar
  * Remova todos os emojis
  * Envolva toda a saída na tag \`<speak>\`
  * **NUNCA** inclua caractere de nova linha \`\\n\` na saída — retorne tudo em uma única linha
  * **NUNCA** envolva a saída em blocos de código (como \`\`\`ssml)
</regras-gerais>

# EXEMPLOS

<exemplos>
  **ATENÇÃO**: Estes são exemplos ilustrativos. Sempre siga as regras e adapte conforme necessário.

  ## Exemplo 1: Mensagem com data, horário e endereço

  **Entrada:**

  Seu agendamento foi confirmado para 12/12/2025 às 09:00 com o Dr. Roberto Almeida. O endereço é Av. das Palmeiras, 1500.

  **Saída esperada:**

  \`<speak><break time="1.0s"/>Seu agendamento foi confirmado para doze de dezembro de 2025 às nove horas com o Doutor Roberto Almeida. O endereço é Avenida das Palmeiras, 1500.</speak>\`

  ---

  ## Exemplo 2: Mensagem com telefone e valor

  **Entrada:**

  O valor da consulta é R$ 500,00. Para mais informações, ligue para (11) 4456-7890 📞

  **Saída esperada:**

  \`<speak><break time="1.0s"/>O valor da consulta é quinhentos reais. Para mais informações, ligue para onze, quatro quatro cinco seis, sete oito nove zero</speak>\`

  ---

  ## Exemplo 3: Mensagem com protocolo

  **Entrada:**

  Seu protocolo de atendimento é 987654321. Guarde esse número! 😊

  **Saída esperada:**

  \`<speak><break time="1.0s"/>Seu protocolo de atendimento é nove oito sete, seis cinco quatro, três dois um. Guarde esse número!</speak>\`
</exemplos>

# FORMATO DE RESPOSTA

<formato-resposta>
  Responda **apenas** com o texto convertido em SSML, sem introduções, explicações ou textos adicionais. A saída deve ser uma única linha contendo o texto dentro da tag \`<speak>\`.
</formato-resposta>
`;

const PROMPT_FORMATAR_TEXTO = `# PAPEL

<papel>
  Você é um agente especialista em pós-processamento de mensagens para WhatsApp. Sua missão é receber uma mensagem gerada por outro agente e realizar duas operações essenciais: **formatar o texto** para o padrão do WhatsApp e **dividir em múltiplas mensagens menores**, simulando o comportamento natural de um humano digitando e enviando aos poucos.
</papel>

# OBJETIVO

<objetivo>
  Receber uma mensagem longa como entrada e retornar o texto:
  1. **Formatado** para WhatsApp (ajustando marcadores de negrito e removendo cabeçalhos Markdown)
  2. **Dividido** em blocos menores separados por \`\\n\\n\`, como um humano faria ao enviar mensagens em sequência
</objetivo>

# REGRAS DE FORMATAÇÃO

<regras-formatacao>
  ### Substituições obrigatórias

  * Substitua \`**\` por \`*\` (negrito Markdown → negrito WhatsApp)
  * Remova todos os \`#\` de cabeçalhos Markdown

  ### Preservação

  * Não altere o conteúdo textual da mensagem
  * Não reescreva frases, apenas formate
  * Mantenha links, e-mails, telefones e valores monetários intactos
</regras-formatacao>

# REGRAS DE DIVISÃO

<regras-divisao>
  ## Princípios

  * Divida a mensagem em blocos menores respeitando a pontuação e pausas naturais
  * As divisões devem parecer naturais — como uma pessoa que digita e envia aos poucos
  * Evite cortar frases no meio
  * Mantenha a mesma ordem do texto original
  * Remova vírgulas e pontos nos finais das mensagens, quando necessário
  * Tente manter cada bloco entre 1 a 4 frases no máximo, se o texto permitir

  ### Limites

  * **NUNCA divida a mensagem em mais de 10 partes**
  * **NUNCA quebre listas em múltiplas mensagens** — mantenha TODOS os itens de lista (com emojis, números ou marcadores) juntos em um único bloco. O bloco começa no texto introdutório e termina após o último item da lista.
  * Se houver uma lista de itens, o bloco deve conter: frase introdutória + todos os itens, sem exceção

  ### Marcador de quebra

  * Use \`\\n\\n\` (duas quebras de linha) para separar cada bloco de mensagem
</regras-divisao>

# EXEMPLOS

<exemplos>
  **ATENÇÃO**: Estes são exemplos ilustrativos. Sempre siga as regras e adapte conforme necessário.

  ### Exemplo 1: Mensagem simples

  **Entrada:**

  Oi! Tudo bem por aí? Estava pensando em te mandar aquele documento ainda hoje, mas antes queria tirar umas dúvidas. Você pode me ligar assim que puder?

  **Saída esperada:**

  Oi! Tudo bem por aí?

  Estava pensando em te mandar aquele documento ainda hoje, mas antes queria tirar umas dúvidas.

  Você pode me ligar assim que puder?

  ---

  ### Exemplo 2: Mensagem com lista (NÃO QUEBRAR)

  **Entrada:**

  Oi! Seguem os documentos que você pediu:
  1. Contrato assinado
  2. Comprovante de pagamento
  3. Nota fiscal
  4. Certificado de conclusão
  Me avisa quando receber tudo!

  **Saída esperada:**

  Oi! Seguem os documentos que você pediu:

  1. Contrato assinado
  2. Comprovante de pagamento
  3. Nota fiscal
  4. Certificado de conclusão

  Me avisa quando receber tudo!

  **❌ INCORRETO (não fazer):**

  Oi! Seguem os documentos que você pediu:

  1. Contrato assinado

  2. Comprovante de pagamento

  3. Nota fiscal

  4. Certificado de conclusão

  Me avisa quando receber tudo!

  ---

  ### Exemplo 3: Mensagem com formatação Markdown

  **Entrada:**

  Olá! Estou te mandando essa mensagem para explicar melhor o que aconteceu ontem. Eu cheguei lá por volta das **18h**, como combinado, mas não encontrei ninguém. Será que houve algum problema?

  **Saída esperada:**

  Olá! Estou te mandando essa mensagem para explicar melhor o que aconteceu ontem

  Eu cheguei lá por volta das *18h*, como combinado, mas não encontrei ninguém

  Será que houve algum problema?

  ---

  ### Exemplo 4: Mensagem com cabeçalho Markdown

  **Entrada:**

  ## Informações importantes
  Seu agendamento foi confirmado para amanhã às 09:00 com o **Dr. Roberto Almeida**. O valor da consulta é **R$ 500,00**. Formas de pagamento: PIX, cartão ou dinheiro. Lembrando que nosso endereço é Av. das Palmeiras, 1500 - Jardim América.

  **Saída esperada:**

  Informações importantes

  Seu agendamento foi confirmado para amanhã às 09:00 com o *Dr. Roberto Almeida*

  O valor da consulta é *R$ 500,00*. Formas de pagamento: PIX, cartão ou dinheiro

  Lembrando que nosso endereço é Av. das Palmeiras, 1500 - Jardim América
</exemplos>

# FORMATO DE RESPOSTA

<formato-resposta>
  Responda **apenas** com a mensagem formatada e dividida, sem introduções, explicações ou textos adicionais. Cada bloco de mensagem deve ser separado por \`\\n\\n\`.
</formato-resposta>
`;

/**
 * O SSML preservou o conteúdo do texto, ou o modelo RESPONDEU em vez de converter?
 *
 * Compara as palavras longas da entrada com as da saída. Números ficam de fora de propósito:
 * convertê-los para a forma falada ("394" → "trezentos e noventa e quatro") é justamente o
 * trabalho do formatador. O corte é generoso — uma conversão legítima mantém quase todas as
 * palavras, já uma resposta do modelo ("desculpe, não posso...") não mantém quase nenhuma.
 */
export function ssmlPreservaOTexto(original: string, ssml: string): boolean {
  const palavras = [...new Set((original.toLowerCase().match(/[a-zà-ú]{5,}/gu) ?? []))];
  if (palavras.length < 3) return true; // curto demais pra julgar
  const saida = ssml.toLowerCase();
  const mantidas = palavras.filter((p) => saida.includes(p)).length;
  return mantidas / palavras.length >= 0.5;
}

/**
 * ⚠️ Este formatador tem a MESMA forma do bug que derrubou as convs 6941/6943/6907: o texto do
 * agente vai como `user` para um segundo modelo, que pode RESPONDÊ-LO em vez de convertê-lo.
 * Na 6907 o agente escreveu "Me conta como foi tua última semana de estudo" e o lead recebeu
 * "Desculpe, mas não posso compartilhar informações pessoais ou experiências."
 *
 * Aqui o LLM não dá pra remover — converter números para a forma falada é o motivo dele existir.
 * Então validamos a saída: se ela não preserva o conteúdo da entrada, foi o modelo respondendo, e
 * caímos no texto original, que o TTS lê bem, só sem a otimização.
 */
export async function formatarSsml(texto: string): Promise<string> {
  try {
    const model = new ChatOpenAI({
      modelName: env.OPENAI_MODEL_MINI,
      openAIApiKey: env.OPENAI_API_KEY,
      temperature: 0.3,
    });

    const resposta = await model.invoke([
      { role: "system", content: PROMPT_FORMATAR_SSML },
      { role: "user", content: texto },
    ]);

    const ssml = resposta.content as string;
    if (!ssmlPreservaOTexto(texto, ssml)) {
      logger.error("response-formatter", "SSML descartado: o formatador respondeu em vez de converter", {
        original: texto.slice(0, 160),
        devolvido: ssml.slice(0, 160),
      });
      return texto;
    }
    return ssml;
  } catch (e) {
    logger.error("response-formatter", "Erro ao formatar SSML:", e);
    return texto;
  }
}

// Linha que é só um item de lista (emoji, marcador ou "1." no início) — listas NUNCA são
// quebradas em bolhas separadas: a introdução e todos os itens ficam no mesmo bloco.
const RE_ITEM_LISTA = /^\s*([-*•✅🎁🔹▪️]|\d+[.)])\s+/u;

/**
 * Formata a resposta do agente para o WhatsApp e a divide em blocos (bolhas).
 *
 * ⚠️ ISTO ERA UMA CHAMADA DE LLM E CAUSOU O PIOR BUG DE PRODUÇÃO ATÉ AQUI. O texto do agente ia
 * como mensagem `user` para um segundo modelo, e quando esse texto era uma PERGUNTA aberta o
 * modelo a RESPONDIA em vez de formatá-la. Nas convs 6941 e 6943 o agente gerou 58 caracteres
 * ("Me conta como foi tua última semana de estudo, na prática.") e o lead recebeu dez mensagens
 * em que a IA narrava a própria semana estudando Python, Pandas e machine learning — o Pedro
 * teve de desligar a IA nas duas.
 *
 * As regras de formatação são triviais e não precisam de modelo nenhum. Determinístico: sem
 * alucinação possível, sem custo, sem latência, e testável.
 */
export function formatarTexto(texto: string): string {
  const original = texto ?? "";
  if (!original.trim()) return original;

  // 1) Markdown → WhatsApp: negrito ** -> * e fora os # de cabeçalho.
  let t = original.replace(/\*\*/g, "*").replace(/^#{1,6}\s*/gm, "");

  // 2) Blocos: o que o agente já separou com linha em branco é respeitado como veio.
  const blocosOriginais = t.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  const blocos: string[] = [];
  for (const bloco of blocosOriginais) {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
    // Bloco que contém lista fica inteiro: introdução + todos os itens numa bolha só.
    if (linhas.some((l) => RE_ITEM_LISTA.test(l))) {
      blocos.push(linhas.join("\n"));
      continue;
    }
    // Sem lista: quebra por fim de frase, agrupando até 2 frases por bolha.
    const frases = linhas
      .join(" ")
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/u)
      .map((f) => f.trim())
      .filter(Boolean);
    for (let i = 0; i < frases.length; i += 2) {
      blocos.push(frases.slice(i, i + 2).join(" "));
    }
  }

  // 3) Teto de 10 bolhas: o excedente vai junto na última, nunca é descartado.
  const limitados = blocos.length <= 10 ? blocos : [...blocos.slice(0, 9), blocos.slice(9).join(" ")];

  return limitados.join("\n\n");
}

export function dividirMensagem(texto: string): string[] {
  const blocos = texto.split("\n\n").filter(b => b.trim());
  return blocos.slice(0, 10);
}

// Divide o texto em frases, para enviar cada uma como uma MENSAGEM separada (bolhas distintas
// no WhatsApp), simulando alguém digitando várias mensagens curtas. Quebra por fim de frase
// (. ! ?) e por quebras de linha existentes. Ignora pontos de números (ex: 3.197) porque exige
// espaço após a pontuação.
export function dividirEmFrases(texto: string): string[] {
  return (texto ?? "")
    .split(/\n+/)
    .flatMap((linha) => linha.split(/(?<=[.!?])[ \t]+(?=\S)/))
    .map((f) => f.trim())
    .filter(Boolean);
}
