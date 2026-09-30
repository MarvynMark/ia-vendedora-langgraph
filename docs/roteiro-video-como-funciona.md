# Roteiro — "A mentoria por dentro"

**Duração alvo:** 3–5 min · **Formato:** gravação de tela da plataforma + Walker narrando
**Onde entra:** substitui o vídeo atual da Msg 5 do roteiro de vendas (`src/tools/enviar-video.ts:9`)
e passa a ser o asset da objeção "quero ver como funciona na prática" (`src/graphs/main-agent/prompt.ts:532`,
hoje um `<!-- PREENCHER -->` vazio)

> **Este vídeo não vende. Ele demonstra.** A função econômica dele é dupla: destravar quem pede
> pra ver antes de decidir, e **prevenir reembolso por expectativa errada**. Evidência literal de
> um comprador que pediu cancelamento: *"eu percebi que o curso não era como eu tinha entendido.
> Achei que, além da mentoria, também teria videoaulas com as matérias..."*
>
> Por isso o bloco 1 existe: dizer com todas as letras o que a mentoria **não** é, antes de
> mostrar o que ela é.

---

## Bloco 1 — O que isso é e o que não é (0:00–0:40)

> Deixa eu te mostrar por dentro como funciona a mentoria, sem enrolação.
>
> E eu vou começar pelo que ela **não** é, porque isso evita frustração dos dois lados.
>
> Isso aqui não é um cursinho. Não é um pacote de videoaula com todas as matérias do edital.
> Se você está procurando alguém pra te dar o conteúdo, não é aqui.
>
> A mentoria é o **caminho**: o que estudar, em que ordem, quanto tempo dar pra cada coisa,
> e alguém acompanhando de perto pra corrigir a rota quando você sair dela.
>
> Feito o aviso, vem comigo.

**Por quê:** o frame errado ("me falta conteúdo") é o que trava a venda e gera reembolso.
Explicitá-lo aqui qualifica o lead e protege a operação. Coerente com `prompt.ts:492`.

---

## Bloco 2 — O cronograma individual (0:40–1:40)

**[TELA: cronograma real de mentorado — anonimizar nome, e-mail e qualquer dado pessoal]**

> Isso aqui é o cronograma de um mentorado de verdade.
>
> Repara que não é uma tabela genérica que eu mando pra todo mundo. Ele é montado a partir de
> três coisas: o **edital** e a **banca** do concurso que você quer, a sua **área de formação**,
> e quantas horas por dia você realmente tem — não quantas você gostaria de ter.
>
> Ele fica pronto em dois, três dias depois que você preenche o formulário de aluno.
>
> E ele não é fixo. Quando o edital do seu concurso sai, a gente reajusta em cima do que foi
> publicado.

**Por quê:** é o asset que a objeção nº 10 pede (`prompt.ts:529-534`). O prazo de 2–3 dias vem de
`aprendizados-compradores.md:25-26`.
⚠️ Anonimizar. ⚠️ Não prometer prazo diferente do que a operação cumpre.

---

## Bloco 3 — O direcionamento diário (1:40–2:20)

**[TELA: painel do aluno mostrando as tarefas do dia]**

> Todo dia você abre e já sabe: essa é a matéria, esse é o assunto, essas são as revisões que
> vencem hoje, essas são as questões pra resolver.
>
> Você não perde tempo decidindo. Você só executa.
>
> Essa é a parte que os mentorados mais comentam comigo: o alívio de acordar e não ter que
> escolher.

**Por quê:** responde diretamente à dor mais citada no formulário — organização/priorização
(321 respostas) e "não sei por onde começar" (189).

---

## Bloco 4 — Acompanhamento direto (2:20–3:10)

**[TELA: conversa de WhatsApp — anonimizar contato e foto]**

> E tem a parte que não dá pra automatizar: você fala comigo.
>
> Não é um chat de suporte genérico. É o meu WhatsApp. Se você travou numa matéria, se a semana
> foi ruim e o cronograma atrasou, se apareceu um edital novo e você quer saber se muda alguma
> coisa — você me chama.
>
> Além disso a gente tem encontros ao vivo com os mentores, e uma comunidade de mentorados, que
> serve pra uma coisa que ninguém fala: não estudar sozinho. Concurso é solitário demais, e
> desistir é muito mais fácil quando não tem ninguém do lado.

**Por quê:** o acesso direto ao Walker é o diferencial nº 1 apontado pelos compradores
(`aprendizados-compradores.md:25-26`).
⚠️ Anonimizar a conversa mostrada.

---

## Bloco 5 — Como você sabe se está funcionando (3:10–3:50)

**[TELA: relatório de desempenho mensal + simulado]**

> Todo mês você recebe um relatório de desempenho: onde você evoluiu, onde ficou parado, o que
> precisa de mais revisão.
>
> E tem os simulados, pra você não descobrir no dia da prova como é fazer prova.
>
> Isso serve pra você parar de estudar no escuro. Você deixa de achar que está indo bem e passa
> a saber.

**Por quê:** fecha o loop de "não sei se estou estudando certo", que é a dor central da VSL.
Fonte da lista: `src/tools/enviar-imagem-entregaveis.ts:13-27`.

---

## Bloco 6 — O que ainda vem junto (3:50–4:20)

> E além de tudo isso, você leva os cursos bônus: Medicina Legal, Criminalística, Genética
> Forense, Balística, Toxicologia e Química. Mais os encontros de apoio pra TAF, temas de
> discursiva, psicotécnico e análise de edital. E noções de Direito Penal, Processual Penal e
> Português.
>
> Isso é o extra. O centro continua sendo o mesmo: o direcionamento.

**Por quê:** lista literal de `src/tools/enviar-imagem-entregaveis.ts:13-27`.
⚠️ "temas de discursiva" é **treino**, não correção de prova. Nunca dizer que a mentoria corrige
discursiva (`prompt.ts:785`).

---

## Bloco 7 — Fecho (4:20–4:40)

> É isso que eu queria te mostrar. Sem promessa mágica: é método, é rotina e é gente
> acompanhando.
>
> Qualquer dúvida sobre o que você viu aqui, me responde ali na conversa que a gente continua.

**Por quê:** devolve o lead para o WhatsApp, onde a IA/comercial conduz. Sem preço e sem CTA de
compra — o vídeo pode ser enviado em qualquer etapa do funil, inclusive antes do gate de material.

---

## Travas — conferir antes de gravar

- ❌ Correção de prova discursiva (`prompt.ts:785`) — só "temas para treinar"
- ❌ Qualquer preço, plano ou parcela — o vídeo circula antes do gate de material
- ❌ Nome, foto ou dado pessoal de mentorado em qualquer tela (`prompt.ts:309`)
- ❌ Prometer disciplina, módulo, material ou bônus fora da lista acima (`prompt.ts:786`)
- ❌ Afirmar data ou publicação de edital (`prompt.ts:333`)
- ❌ Prometer condição de renovação (`prompt.ts:525` — política ainda não definida)

---

## Depois de gravado

1. Subir o arquivo e trocar `VIDEO_PLATAFORMA_URL` em `src/tools/enviar-video.ts:9`
2. Trocar o link de reenvio em `prompt.ts:281`
3. Preencher `<!-- PREENCHER: asset de amostra -->` em `prompt.ts:532` apontando para a tool
   `Enviar_video`, para que quem pedir "quero ver na prática" receba o vídeo
4. Testar com `/teste` no webhook e confirmar a entrega pelo Chatwoot
