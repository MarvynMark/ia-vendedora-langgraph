# Roteiro — VSL da Mentoria Vestigium

**Duração alvo:** 9–11 min · **Formato:** Walker à câmera, inserts de tela
**Onde roda:** página de obrigado do formulário de aplicação (o lead assiste enquanto a IA o chama no WhatsApp)
**Corte curto:** 60–90s (blocos 1, 2 e 9) para Instagram

> **Este vídeo não fala preço.** O preço no funil é condicional: há roteamento médico vs. não-médico
> (`src/graphs/main-agent/prompt.ts:55-57`), gate de material travado em código (`src/lib/gate-material.ts:34`)
> e pares de plano diferentes conforme o lead já tenha material (`prompt.ts:358`). Um número fixo no
> vídeo entrega ao lead médico um valor que é proibido oferecer a ele (`prompt.ts:82-93`).
> A VSL vende o problema e o método. O preço continua sendo da IA.

> **A tese:** mover o espectador do frame *"me falta conteúdo"* para o frame *"me falta direção"*.
> Nos dados, quem descreve o próprio problema como eficiência compra; quem descreve como
> conhecimento não compra — e, quando compra, pede reembolso. Ver `output/briefing-copy-*/00-BRIEFING.md`.

---

## Bloco 1 — Gancho (0:00–0:20)

> Se você preencheu o formulário da mentoria, é porque alguma coisa na sua preparação não está
> fechando a conta.
>
> E eu vou te falar uma coisa que talvez você não queira ouvir: na maioria dos casos que eu
> analiso, o problema não é o que você acha que é.
>
> Você acha que te falta conteúdo. Não falta.

**Por quê:** ataca de frente o frame errado, que é o que separa comprador de perdido nos dados.
Sem promessa, sem "olá pessoal". Os primeiros 20 segundos decidem se o lead assiste.

---

## Bloco 2 — A virada de frame (0:20–2:30)

> Eu leio as respostas de todo mundo que preenche esse formulário. Todas. E dá pra separar em
> dois grupos.
>
> O primeiro grupo escreve assim: *"eu preciso aprender mais"*, *"me falta conhecimento"*,
> *"me falta tudo"*.
>
> O segundo grupo escreve assim: *"eu estudo, mas não sei se estou estudando a coisa certa"*,
> *"perco tempo decidindo por onde começar"*, *"leio, faço exercício e parece que não absorvo"*.
>
> Os dois grupos têm o mesmo problema. Mas só o segundo grupo enxergou qual é.
>
> Porque conteúdo, hoje, é a coisa mais barata que existe. Você tem PDF, tem videoaula, tem
> curso, tem canal no YouTube, tem edital comentado. Se conteúdo aprovasse, quem tem mais
> material passava — e não é isso que acontece.
>
> O que reprova não é a falta de conteúdo. É o excesso dele sem ordem.
>
> [PAUSA]
>
> Um aluno meu escreveu uma frase que eu uso até hoje: *"não adianta estudar o dia inteiro se
> não estudar com estratégia"*. Outro escreveu: *"o estudar em si eu consigo, seis horas por dia.
> Minha dificuldade é organizar — quais matérias, quais revisões, quais questões"*.
>
> Percebe? Essas pessoas não precisavam de mais aula. Precisavam de alguém dizendo o que fazer
> com as horas que já têm.

**Por quê:** é o coração do vídeo. Usa frases literais de compradores (`04-transformacao.md`,
`01-frames.md`). O "eu leio todas as respostas" é verdade e constrói autoridade e reciprocidade.
**Insert sugerido:** frases reais anonimizadas na tela, sem nome.

---

## Bloco 3 — Por que sozinho não funciona (2:30–4:00)

> Agora, por que é tão difícil resolver isso sozinho?
>
> Não é falta de força de vontade. É que você não tem como saber o que não sabe.
>
> Quando você monta o próprio cronograma, você monta com a informação que você tem. E a
> informação que você tem vem da internet, de grupo de WhatsApp, de gente que também não passou
> ainda. Você acaba dando o mesmo peso pra matéria que vale trinta questões e pra matéria que
> vale três. Você estuda o que gosta mais, não o que cai mais.
>
> E o mais cruel: você só descobre que errou depois da prova. Aí já foi um ano.
>
> Eu recebo muita mensagem assim: *"depois de um mês tentando organizar sozinha meus estudos,
> sinto que estou no mesmo lugar"*. *"Percebi que sozinha eu estava meio perdida sobre como
> começar a estudar de verdade."*
>
> Isso não é fraqueza sua. É a matemática do negócio: você está tentando desenhar o caminho e
> caminhar nele ao mesmo tempo.

**Por quê:** "Vai estudar sozinho" é a 3ª maior causa de perda (115 de 733 rotuladas). O bloco
não ataca quem tenta — valida e reenquadra. Frases retiradas de `01-frames.md`.

---

## Bloco 4 — Quem pode prestar (4:00–4:40)

> Antes de continuar, preciso limpar uma confusão que faz muita gente boa desistir antes de
> começar.
>
> Você **não** precisa estar formado pra prestar concurso de perícia. O diploma é exigido na
> posse, não na inscrição. E entre a prova e a nomeação costuma passar bastante tempo.
>
> Então se você está no segundo, no terceiro, no quinto semestre da faculdade: esse é o melhor
> momento da sua vida pra começar. Você chega na prova com anos de preparo, não com meses.
>
> O que muda de estado pra estado é **quais** graduações o edital aceita. Isso a gente vê junto,
> com o edital do seu estado na mão. O que eu não quero é que você desista por uma informação
> errada.

**Por quê:** "Não tem graduação" é a **2ª maior causa de perda** (153 de 733, 21%) e é em boa
parte erro de premissa. A regra está em `prompt.ts:119-121` e travada em `src/lib/elegibilidade.ts:66`.
Quarenta segundos aqui recuperam lead e economizam tempo do comercial.
⚠️ Não afirmar nem negar que uma formação específica é aceita.

---

## Bloco 5 — O custo de continuar assim (4:40–5:40)

> Deixa eu te fazer uma pergunta desconfortável.
>
> Se você continuar estudando exatamente como está estudando hoje, mais seis meses — onde você
> vai estar?
>
> Porque a resposta honesta, pra maioria, é: no mesmo lugar. Um pouco mais cansado. Um pouco
> mais em dúvida se vale a pena.
>
> Quase todo mundo que preenche esse formulário me conta que tem um plano B. E tudo bem ter.
> Mas eu já vi muita gente boa transformar o plano B em plano A sem perceber — não porque
> escolheu, mas porque foi ficando cansada de tentar sem direção.
>
> O concurso não te vence pela dificuldade da prova. Te vence pelo desgaste.

**Por quê:** custo da inação construído sobre as respostas de plano B — em que compradores
descrevem planos concretos e perdidos escrevem "continuo tentando". Sem catastrofizar.

---

## Bloco 6 — Quem está falando com você (5:40–6:40)

> Se a gente não se conhece: eu sou o Walker. Sou perito criminal, aprovado em mais de seis
> concursos públicos.
>
> E olha só, isso é importante pra você: eu não venho da área. Minha formação é tecnologia da
> informação. Eu não cresci ouvindo falar de perícia, não tinha ninguém na família pra me
> explicar como funcionava.
>
> Eu tive que descobrir tudo do zero, errando. E foi errando que eu entendi que o que aprova
> não é acumular conteúdo — é ter método e alguém te acompanhando de perto.
>
> Hoje eu ensino exatamente o método que eu usei, e já aprovei centenas de mentorados com ele.

**Por quê:** 71% dos leads são iniciantes e a maioria vem de outra formação. O "eu não vinha da
área" é o ponto de identificação mais forte disponível. Dados: `prompt.ts:112-122`.
⚠️ "mais de 6 concursos" e "centenas de mentorados" são os números autorizados. Não inflar.

---

## Bloco 7 — Prova (6:40–7:40)

> No último concurso de Perito Criminal do Rio Grande do Sul, **93% dos meus alunos passaram
> para as próximas fases**. Muitos deles estudando duas, três horas por dia.
>
> E tem um detalhe nesse número que quase ninguém repara, e que talvez seja a parte mais
> importante deste vídeo:
>
> **eles não começaram quando o edital saiu.** Eles já estavam estudando comigo meses antes.
>
> Quando o edital é publicado, todo mundo começa junto. Todo mundo tem a mesma informação no
> mesmo dia. A diferença entre quem passa e quem fica pra próxima foi construída **antes** —
> naquele período em que parecia que não tinha pressa nenhuma.

**Por quê:** único número de resultado autorizado (`prompt.ts:299`, obrigatório em `prompt.ts:774`).
Prova e urgência verdadeira na mesma frase (`prompt.ts:519-520`).
⚠️ Não citar edital específico, data, nem previsão de publicação (`prompt.ts:333`).

---

## Bloco 8 — As três dúvidas que sempre aparecem (7:40–9:20)

> Três coisas que eu sei que estão passando na sua cabeça agora.
>
> **"Walker, eu não tenho tempo."**
> A mentoria não pede mais horas. Ela faz cada hora valer mais. A maioria dos meus mentorados
> trabalha, tem plantão, tem faculdade — e estuda de duas a quatro horas por dia. O problema
> quase nunca é falta de tempo. É tempo mal usado: a pessoa gasta metade dele decidindo o que
> estudar.
>
> **"Eu já tenho cursinho, já tenho material."**
> Ótimo, continua com ele. Mentoria não substitui cursinho — cursinho entrega conteúdo, mentoria
> diz o que priorizar, em que ordem e quanto tempo dar a cada matéria pela sua banca. Dá pra ter
> o melhor material do Brasil e chegar na prova sem ter estudado o que mais cai.
>
> **"Vou esperar o edital sair."**
> Essa é a mais cara de todas. Eu acabei de te contar o que aconteceu no Rio Grande do Sul.
> Quem esperou o edital chegou atrasado numa corrida que já tinha começado.

**Por quê:** as três objeções mais frequentes, com os roteiros já validados em produção
(`src/scripts/ingerir-roteiros-objecao.ts:29-62`, `prompt.ts:490-520`). Antecipar aqui reduz o
trabalho da IA no WhatsApp.

---

## Bloco 9 — Chamada (9:20–10:00)

> Eu não pego todo mundo ao mesmo tempo. Como eu acompanho cada mentorado de perto, eu escolho
> quem entra — e é por isso que existe o formulário que você preencheu.
>
> Eu já recebi as suas respostas. Vou te chamar no WhatsApp pra conversar sobre elas: o seu
> concurso, a sua formação, quanto tempo você realmente tem por dia.
>
> Só te peço uma coisa: **responde**. Nem que seja pra me dizer que não é o momento. Eu prefiro
> um "não" honesto a um lead que some.
>
> Porque se tem uma coisa que eu aprendi aprovando gente, é que o preparo começa no dia em que
> você para de estudar no escuro.
>
> Até já.

**Por quê:** CTA é responder no WhatsApp, não comprar — o fechamento é da IA/comercial.
"Sem resposta" é a maior causa de perda (291 de 733), então o pedido explícito de resposta é
o CTA de maior retorno. Escassez de critério, nunca numérica (`prompt.ts:300, 304`).

---

## Travas — conferir antes de gravar

- ❌ Correção de prova discursiva — a mentoria **não corrige** (`prompt.ts:785`)
- ❌ Salário do cargo (`prompt.ts:355`) e custo por dia (`prompt.ts:464`)
- ❌ Afirmar que edital saiu, vai sair, ou dar data (`prompt.ts:333`)
- ❌ Número de vagas, contador, prazo de turma (`prompt.ts:304`)
- ❌ Percentual de desconto (`prompt.ts:396`)
- ❌ Dizer que alguém não pode prestar por estar cursando (`prompt.ts:119-121`)
- ❌ Qualquer preço ou plano
- ❌ Nome real de aluno em depoimento (`prompt.ts:309`)
