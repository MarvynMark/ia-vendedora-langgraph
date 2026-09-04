/**
 * Ingere no RAG os roteiros de objeção que saíram do prompt.
 *
 * Motivo: 15 blocos de objeção ocupavam 16,7k chars do prompt (~4,6k tokens em TODA chamada,
 * 2 por turno), mas 12 deles não apareceram uma única vez nas últimas 150 conversas. A trava de
 * segurança de cada um continua no prompt; o roteiro de contorno vive aqui e é buscado sob demanda
 * pela tool Buscar_contexto_similar (tipo: "objecao").
 *
 * O embedding é gerado a partir dos GATILHOS (as frases como o lead as diz), não do roteiro —
 * a busca compara com "o lead disse X", então é a fala do lead que precisa estar no vetor.
 *
 * Idempotente: apaga os documentos com metadata.origem = "roteiro_prompt" antes de reinserir.
 * Não toca nos casos reais (conversa_ganha e as objeções extraídas de conversas).
 *
 *   bun run src/scripts/ingerir-roteiros-objecao.ts
 */
import { pool } from "../db/pool.ts";
import { inserirDocumento } from "../db/rag.ts";
import { gerarEmbedding } from "../services/embeddings.ts";

interface Roteiro {
  titulo: string;
  gatilhos: string;
  conteudo: string;
}

const ROTEIROS: Roteiro[] = [
  {
    titulo: "ROTEIRO — Não tenho tempo pra estudar",
    gatilhos:
      "não tenho tempo agora, trabalho o dia todo, minha rotina é corrida, não consigo estudar todo dia, tenho pouco tempo livre, plantão, dupla jornada",
    conteudo:
      'A mentoria não pede mais horas, ela faz cada hora valer mais — o lead para de perder tempo decidindo o que estudar.\n\n"A maioria dos nossos mentorados trabalha e tem só 2 a 4 horas por dia. O problema quase nunca é falta de tempo, é o tempo mal usado: a pessoa gasta metade decidindo o que estudar. Hoje você consegue quantas horas por dia?"\n\nTermine sempre com a pergunta da rotina — ela devolve a conversa pro diagnóstico em vez de virar debate.',
  },
  {
    titulo: "ROTEIRO — Diferença entre mentoria e cursinho",
    gatilhos:
      "qual a diferença entre mentoria e cursinho, isso é um curso preparatório, é tipo o Estratégia, mentoria e cursinho é a mesma coisa, o que exatamente é a mentoria",
    conteudo:
      'Cursinho entrega conteúdo e o aluno se vira pra organizar. A mentoria é pra quem quer seguir o plano dos aprovados e chegar mais rápido.\n\n"Muita gente confunde, mas são coisas diferentes. O cursinho te entrega o conteúdo e você tem que se virar pra organizar e estudar. A mentoria é o caminho: o que priorizar, em que ordem, quanto tempo dar a cada matéria pela sua banca — com acompanhamento de perto. Os nossos mentorados foram aprovados na objetiva do Perito do IGP-RS seguindo isso. Não é sorte, é método."\n\nNÃO use esse enquadramento pra desqualificar cursinho — muitos leads têm um e ficam na defensiva.',
  },
  {
    titulo: "ROTEIRO — Já fiz mentoria e não funcionou",
    gatilhos:
      "já fiz mentoria e não funcionou, já paguei mentoria e me arrependi, mentoria é tudo promessa, já caí nessa antes, comprei um curso e não usei",
    conteudo:
      'Não defenda a Vestigium de cara — investigue. O problema anterior quase sempre é exatamente o que a Vestigium resolve, e é o próprio lead quem precisa dizer isso.\n\n"Entendo essa desconfiança. Tem muita mentoria por aí que promete e entrega pouco. Me conta: o que especificamente não funcionou? Foi falta de acompanhamento, cronograma genérico, suporte que sumiu?"\n\nDeixe ele falar antes de qualquer contra-argumento. Depois espelhe o que ele disse ligando ao acompanhamento de perto do Walker.',
  },
  {
    titulo: "ROTEIRO — Já tenho cursinho / material suficiente",
    gatilhos:
      "já tenho cursinho, já assino o Estratégia, já tenho material, tenho apostila, já pago um curso, não preciso de mais material",
    conteudo:
      'Nunca oponha a mentoria ao material dele — some as duas coisas.\n\n"Ótimo, e você continua usando. A mentoria não substitui o cursinho, ela direciona como usar. Cursinho entrega conteúdo. A mentoria te diz o que priorizar, em qual ordem e quanto tempo dedicar a cada matéria de acordo com a sua banca. Dá pra ter o melhor material do Brasil e chegar na prova sem ter estudado o que mais cai — é isso que a mentoria resolve."\n\nTRAVA: como ele JÁ tem material, siga na mentoria pura (Anual normal ou Semestral). NÃO empurre o Anual Completo nem o Semestral Premium — o material seria redundante e o lead percebe que é upsell.',
  },
  {
    titulo: "ROTEIRO — Não tem edital, vou esperar sair",
    gatilhos:
      "não tem edital ainda, vou esperar sair o edital, quando sair o edital eu começo, não faz sentido estudar sem edital, e se não sair concurso",
    conteudo:
      'É o argumento de urgência mais forte que existe e é verdade — use sem medo, mas sem inventar data de edital.\n\n"Quando o edital sai, todo mundo começa ao mesmo tempo. Entre a publicação e a prova não dá tempo de construir base, só de revisar o que já se sabe. Os aprovados no IGP do RS tinham meses de preparação antes do edital aparecer — não começaram no dia da publicação. Começar antes é o que te coloca na frente."\n\nTRAVA: nunca afirme que um edital saiu, que vai sair, ou em que data. Nenhum candidato sabe isso.',
  },
  {
    titulo: "ROTEIRO — E se o edital demorar mais que o plano / quando o acesso acabar",
    gatilhos:
      "e se o edital demorar mais que os 6 meses, o que acontece quando acabar o acesso, e depois do plano, tem renovação, e se o concurso sair depois",
    conteudo:
      'Objeção real e recorrente, principalmente no Semestral.\n\nEnquadramento seguro: o que importa é chegar no edital JÁ preparado; o plano cobre o período de construir base, e começar agora coloca o lead na frente de quem só vai começar quando o edital sair.\n\nTRAVA CRÍTICA: NÃO improvise política de renovação nem invente condição ou valor — um número errado aqui quebra a confiança e vira problema no pós-venda. Se o lead CONDICIONAR a compra a saber exatamente a política de renovação, use Escalar_humano pra uma pessoa confirmar. Nunca chute e nunca responda "quando chegar lá a gente vê".',
  },
  {
    titulo: "ROTEIRO — Onde consigo o conteúdo específico da minha área",
    gatilhos:
      "onde consigo o conteúdo da minha área, vou ter que pagar outro curso, tem material de biomedicina, e o conteúdo específico da minha formação, quem me dá o material",
    conteudo:
      'Dúvida REAL de material (não de método) — o lead percebe na hora se você enrola.\n\nTRAVA: NUNCA repita "materiais complementares e fontes confiáveis" em loop; é a frase que mais fez lead sumir.\n\n- A mentoria diz O QUE estudar e em que ordem; ela não é a fonte de conteúdo de todas as matérias.\n- Se o lead NÃO tem material: o caminho é o Anual Completo, que já inclui a assinatura Premium do Estratégia Concursos (videoaulas, PDFs e questões de todas as matérias que a banca cobra). É ali que ele resolve o "onde consigo o conteúdo" sem contratar nada por fora.\n- Se ele JÁ tem material mas cobra conteúdo hiper-específico da formação que talvez nem exista pronto: seja honesto — você orienta onde buscar e prioriza o que a banca cobra, mas NÃO invente que existe um material da área dele.\n- Se ele insistir na MESMA dúvida depois de você ter respondido com clareza: NÃO repita a resposta, use Escalar_humano. Loopar a mesma frase perde a venda.',
  },
  {
    titulo: "ROTEIRO — Não sei se terá vaga para minha área / especialidade",
    gatilhos:
      "não sei se vai ter vaga pra minha área, vocês atendem biomedicina, meu diploma será aceito, nunca teve concurso pra perito da minha formação, tem vaga pra odontologia",
    conteudo:
      'Use tanto quando o lead levantar quanto PROATIVAMENTE, se a dúvida já vier no maior_dificuldade do formulário.\n\nTRAVA: PROIBIDO responder com um "sim, fazemos" raso e emendar preço/upsell — soa desonesto e quebra a confiança. NÃO garanta que existe ou existirá vaga pra área dele; ninguém sabe antes do edital.\n\n"Ninguém sabe quais áreas o edital vai abrir antes de sair. O que dá pra saber é que, quando abrir, quem já está estudando com método sai na frente de quem começou do zero. A questão não é se vai ter vaga pra sua área — é se você vai estar pronto quando a vaga aparecer. A mentoria prepara pro conteúdo que a banca cobra, com plano individual pela sua formação."\n\nSe a elegibilidade da formação for o ÚNICO ponto que trava a decisão e não der pra confirmar pelo edital: Escalar_humano. Nunca afirme NEM negue elegibilidade sem base factual.',
  },
  {
    titulo: "ROTEIRO — Quero ver como funciona na prática / exemplo de cronograma",
    gatilhos:
      "quero ver como funciona na prática, me mostra um exemplo de cronograma, dá pra ver a plataforma antes, tem algum print, como é por dentro",
    conteudo:
      'Pedido legítimo de prova tangível, típico de lead analítico. Não enrole nem repita descrição genérica.\n\n- O jeito de ver a mentoria por dentro SEM risco é a garantia de 7 dias: ele entra, vê o cronograma montado pra ele e o acompanhamento de perto, e se não for pra ele devolvemos cada centavo. Use como ponte pro fechamento.\n- TRAVA: se ele disser que só fecha DEPOIS de ver um exemplo concreto e você não tem o material pra enviar, use Escalar_humano. NUNCA prometa enviar material que você não tem nem invente um cronograma de exemplo.',
  },
  {
    titulo: "ROTEIRO — Escada de downsell quando o preço trava",
    gatilhos:
      "tá caro, não tenho esse dinheiro agora, tem algo mais barato, qual o plano mais em conta, tô sem condições, não cabe no meu orçamento agora",
    conteudo:
      'Primeiro separe forma de pagamento (resolve com boleto/PIX parcelado, mantendo o plano) de renda de verdade (parcelar não muda que a parcela precisa caber).\n\nESCADA — 2 etapas, nunca pule:\n1. Boleto/PIX parcelado do MESMO plano ancorado — 12x, uma por mês, sem depender de limite de cartão.\n2. Semestral (12x de R$ 197): "6 meses comigo, uma versão mais enxuta que cabe melhor no seu momento."\n3. Trimestral (12x de R$ 98,35, menos de R$ 100 por mês) — SÓ depois do Semestral ter sido recusado por preço, e APENAS se o lead NÃO for médico.\n\nTRAVA: é PROIBIDO oferecer o Trimestral antes do Semestral, mesmo que o lead peça literalmente "o mais barato de todos". É PROIBIDO responder falta de renda com o discurso de parcelamento como se resolvesse. É PROIBIDO responder "tá caro" com o salário do cargo ou com o custo por dia.\n\nO downsell fecha como o pitch: um plano só, uma pergunta só — "Este plano encaixa pro seu momento? Pode ser transparente comigo." Sem garantia, sem pedir permissão pro link, sem "o que achou?".\n\nSe nem o Trimestral couber, é "não agora": combine um retorno com DATA e não empurre.',
  },
  {
    titulo: "ROTEIRO — A mentoria é um curso completo? tem aulas e material?",
    gatilhos:
      "é um curso completo, tem aulas gravadas, tem material em PDF, tem questões comentadas, o acesso às aulas é completo, vem apostila, tem videoaula de todas as matérias",
    conteudo:
      'TRAVA: a mentoria NÃO é cursinho e NÃO entrega o material de todas as matérias. É PROIBIDO dizer que o Anual, o Semestral ou o Trimestral "puros" incluem aulas gravadas de todas as matérias, apostilas, PDF ou banco de questões — eles NÃO incluem. Só o Anual Completo tem material completo, pela assinatura Premium do Estratégia Concursos.\n\nO que a mentoria entrega: o método gravado do Walker, os encontros ao vivo, o suporte no WhatsApp, a comunidade, os relatórios/simulados/guias e os cursos bônus (Medicina Legal, Criminalística, Genética). O valor é método + acompanhamento + plano sob medida, não acumular conteúdo.\n\nLead não médico sem material → transparência e roteamento pro Anual Completo: "A mentoria é o método e o acompanhamento pra você estudar com direção. O material completo das matérias vem no plano Anual Completo, que já traz a assinatura Premium do Estratégia junto, tudo num lugar só. Quer que eu te mostre como fica?"\n\nSe o lead JÁ tem material, não empurre o Anual Completo — siga na mentoria pura.\n\nSE O LEAD É MÉDICO: o Médico Legista Semestral JÁ inclui o material completo. É PROIBIDO oferecer o Anual Completo ou qualquer plano de Perito Criminal a médico, inclusive quando ele pergunta sobre material.',
  },
];

async function main() {
  const client = await pool.connect();
  try {
    const del = await client.query(
      `DELETE FROM rag_documentos WHERE metadata->>'origem' = 'roteiro_prompt'`,
    );
    console.log(`Removidos ${del.rowCount} roteiros antigos.`);
  } finally {
    client.release();
  }

  for (const r of ROTEIROS) {
    const embedding = await gerarEmbedding(`${r.titulo}\n${r.gatilhos}`);
    await inserirDocumento({
      tipo: "objecao",
      titulo: r.titulo,
      conteudo: r.conteudo,
      metadata: { origem: "roteiro_prompt", gatilhos: r.gatilhos },
      embedding,
    });
    console.log(`  + ${r.titulo}`);
  }
  console.log(`\n${ROTEIROS.length} roteiros ingeridos.`);
  process.exit(0);
}

main();
