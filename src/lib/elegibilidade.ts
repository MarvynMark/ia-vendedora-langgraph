// TRAVA DE ELEGIBILIDADE — impede a IA de dizer a um lead que ele não pode prestar o concurso
// por ainda não ter terminado a graduação.
//
// É FALSO: a graduação prevista no edital é cobrada na POSSE, não para fazer a prova. Entre a
// prova e a nomeação costuma passar bastante tempo, então quem está no meio da faculdade não só
// pode prestar como é quem tem mais prazo pra chegar preparado.
//
// Conv 7197: a lead estava no 2º semestre de Biomedicina e escreveu, duas vezes, que não sabia se
// já podia prestar ("nem se posso fazer ja", "mas nn sei se posso fazer, pq estou apenas no
// segundo semestre"). Recebeu: "Para prestar o concurso de Perito, você precisa ter a graduação
// completa" e "Como você está no segundo semestre, ainda não seria elegível para prestar o
// concurso." Ou seja, a IA mandou embora exatamente o perfil que mais tem tempo de estudo pela
// frente — e disse uma inverdade para fazer isso.
//
// Diferente dos outros filtros de saída, aqui não basta descartar a bolha: a pergunta do lead
// ficaria sem resposta. O turno é SUBSTITUÍDO pela resposta correta.

/**
 * A frase NEGA que o lead possa prestar por causa da graduação incompleta?
 *
 * Os padrões são estreitos de propósito: falar de diploma, posse ou edital é legítimo e precisa
 * passar. O que se bloqueia é a ligação "não pode PRESTAR" + "graduação/diploma/formatura".
 */
// ⚠️ Nada de \b encostado em palavra acentuada: em JS "é"/"í" não são \w, então /\b[ée] preciso\b/
// nunca casa depois de um espaço. Mesma pegadinha já documentada nos filtros de services/chatwoot.ts.

// A frase AFIRMA a verdade? Desarma tudo antes de qualquer outro teste — a resposta correta
// contém "não precisa estar formada pra prestar", que dispara os padrões de negação por conter
// exatamente as mesmas palavras, só que negadas.
const AFIRMA_A_VERDADE: RegExp[] = [
  /n[ãa]o (precisa|é preciso|[ée] preciso|precisar[áa]|tem que)\s+(estar |ser |ter |se )?(formad|graduad|gradua[çc][ãa]o|o diploma|conclu|formar)/i,
  /pode (prestar|fazer|participar|se inscrever)[^.!?]{0,60}(mesmo|ainda|enquanto)[^.!?]{0,30}(cursando|estudando|na faculdade|se formando|no meio)/i,
  /(diploma|gradua[çc][ãa]o|forma[çc][ãa]o)[^.!?]{0,40}(s[óo]|apenas|somente)[^.!?]{0,30}(exigid|cobrad|pedid|necess)[^.!?]{0,30}na posse/i,
  /(s[óo]|apenas|somente)\s+(é |e )?(exigid[oa]|cobrad[oa]|pedid[oa])\s+na posse/i,
];

const PADROES_NEGA_ELEGIBILIDADE: RegExp[] = [
  // "ainda não seria elegível", "não é elegível"
  /(ainda )?n[ãa]o (seria|ser[áa]|é|[ée]|est[áa]|estaria)\s+eleg[íi]vel/i,
  // "não pode/poderia prestar", "não conseguiria fazer o concurso"
  /n[ãa]o (pode|poderia|consegue|conseguiria|vai poder|poder[áa])[^.!?]{0,80}(prestar|fazer|participar|concorrer|se inscrever)/i,
  // "para prestar você precisa ter a graduação completa / estar formado / ter o diploma"
  /(para|pra)\s+(prestar|fazer|participar d|concorrer|se inscrever)[^.!?]{0,60}(precisa|necessita|tem que|é preciso|[ée] preciso|exige|s[óo] com)[^.!?]{0,60}(gradua[çc][ãa]o|formad[oa]|diploma|conclu[íi]d|completa|formatura)/i,
  // ordem invertida: "precisa ter a graduação completa para prestar"
  /(precisa|necessita|tem que|é preciso|[ée] preciso|s[óo] pode)[^.!?]{0,60}(gradua[çc][ãa]o (completa|conclu[íi]da)|estar formad[oa]|ser formad[oa]|ter o diploma|ter conclu[íi]do)[^.!?]{0,60}(para|pra)\s+(prestar|fazer|participar|concorrer|se inscrever)/i,
];

// Contexto de graduação: sem ele, "não pode fazer" / "não é elegível" pode ser sobre outra coisa
// (pagar em dois cartões, desconto de ex-aluno). Exigido nos dois primeiros padrões, que são os
// genéricos; os outros dois já nomeiam a graduação dentro do próprio padrão.
const RE_CONTEXTO_GRADUACAO = /(gradua[çc][ãa]o|graduad[oa]|formad[oa]|forma[çc][ãa]o|diploma|faculdade|cursando|curso superior|semestre|per[íi]odo|formatura)/i;

export function negaElegibilidadePorGraduacao(texto: string): boolean {
  const t = texto ?? "";
  if (!t.trim()) return false;
  if (AFIRMA_A_VERDADE.some((re) => re.test(t))) return false;
  const temContexto = RE_CONTEXTO_GRADUACAO.test(t);
  return PADROES_NEGA_ELEGIBILIDADE.some((re, i) => re.test(t) && (i > 1 || temContexto));
}

/**
 * Resposta que substitui o turno bloqueado. Diz a verdade sem prometer o que não se sabe: prestar
 * não depende de estar formado, e QUAIS graduações o edital aceita varia por estado — isso se
 * confere no edital, não se chuta.
 */
export const RESPOSTA_ELEGIBILIDADE =
  "Pode sim, e essa é uma dúvida super comum. Você não precisa estar formada pra prestar o concurso: " +
  "o diploma só é exigido na posse, e entre a prova e a nomeação costuma passar bastante tempo. " +
  "O que muda de um estado pro outro é quais graduações o edital aceita, e isso a gente confere no edital do teu concurso. " +
  "Estar no comecinho da faculdade é justamente a melhor hora pra começar, porque você chega na prova com anos de preparo. " +
  "Quer que eu te mostre como seria a tua preparação começando agora?";

// ─────────────────────────────────────────────────────────────────────────────
// GATE DE NÍVEL SUPERIOR — quem pode ocupar a agenda da sessão estratégica.
//
// O cargo exige nível superior, então lead sem graduação nenhuma não deve consumir 30 minutos de
// call. Mas o erro caro aqui é o FALSO NEGATIVO: "não tem graduação" é a 2ª maior causa de perda
// registrada na planilha de aplicação (153 de 733) e é, em boa parte, erro de premissa — o diploma
// é cobrado na POSSE. Quem está cursando é justamente quem tem MAIS tempo de preparo pela frente.
//
// Por isso o default é QUALIFICAR: só desqualifica declaração explícita e inequívoca de que não
// tem e não está cursando. Falso negativo custa venda; falso positivo custa meia hora.
//
// Entrada: o `area_graduacao` do formulário (texto livre — "Biomedicina", "cursando Direito",
// "só o ensino médio", "ainda não fiz faculdade").

export type SituacaoSuperior = "tem" | "cursando" | "nao";

// Testado ANTES da negação de propósito: "não tenho ainda, tô cursando o 3º período" é CURSANDO,
// e a negação sozinha classificaria como "nao" — mandando embora exatamente o perfil certo.
const RE_CURSANDO =
  /cursand|em curso|em andamento|faculdade|graduando|incomplet|trancad|\d\s*[ºo°]?\s*(semestre|per[íi]odo|ano)|(primeiro|segundo|terceiro|quarto|quinto|sexto|s[ée]timo|oitavo|nono|d[ée]cimo)\s+(semestre|per[íi]odo|ano)|me formo|vou me formar|terminando|finalizando/i;

const RE_SEM_SUPERIOR =
  /n[ãa]o tenho|n[ãa]o possuo|n[ãa]o fiz|n[ãa]o conclu|sem gradua|sem forma[çc][ãa]o|sem curso superior|nenhuma|nenhum|ensino m[ée]dio|segundo grau|apenas o m[ée]dio|s[óo] o m[ée]dio|t[ée]cnico apenas|ainda n[ãa]o/i;

/**
 * Classifica a situação de nível superior do lead a partir do texto do formulário.
 * `null` = não deu para saber (campo vazio ou resposta ambígua) — e nesse caso o lead QUALIFICA.
 */
export function qualificacaoSuperior(texto: string | null | undefined): SituacaoSuperior | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  if (RE_CURSANDO.test(t)) return "cursando";
  if (RE_SEM_SUPERIOR.test(t)) return "nao";
  // Sobrou um nome de curso ("Biomedicina", "Direito", "Enfermagem") — é graduação declarada.
  // Exige ao menos 3 letras para não classificar lixo ("-", "x", "??") como formação.
  if (/[a-zà-ú]{3,}/i.test(t)) return "tem";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAÇÃO NÃO ACEITA — tem diploma, mas os editais de Perito Criminal não aceitam.
//
// Regra do Gusthavo (11/09/2026): a graduação em "Investigação Forense e Perícia Criminal"
// (tecnólogo) NÃO é aceita como formação para o cargo. Quem só tem ela está, para efeito de
// posse, na mesma situação de quem não tem graduação — e o convite para a sessão seria uma
// meia hora que termina em "não posso te ajudar".
//
// Só barra quando essa é a ÚNICA formação declarada. "Biomedicina e tecnólogo em investigação
// forense" tem uma graduação aceita e passa — falso negativo custa venda.

const RE_FORMACAO_NAO_ACEITA = /investiga[çc][ãa]o forense|per[íi]cia criminal/i;

// Palavras que sobram num campo de formação sem formar outro curso: títulos, adjetivos, conectivos.
// Comparadas sem acento (ver o aviso sobre \b e acentuação no topo do arquivo).
const ENCHIMENTO = new Set([
  "tecnologo", "tecnologa", "tecnologia", "tecnico", "tecnica", "curso", "superior", "graduacao",
  "graduado", "graduada", "formado", "formada", "formacao", "bacharel", "bacharelado", "licenciatura",
  "completo", "completa", "concluido", "concluida", "cursando", "area", "nivel", "ensino", "faculdade",
  "sou", "tenho", "fiz", "com", "por", "para", "pra", "em", "de", "do", "da", "e", "no", "na", "ja",
]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function formacaoNaoAceita(areaGraduacao: string | null | undefined): boolean {
  const t = (areaGraduacao ?? "").trim();
  if (!RE_FORMACAO_NAO_ACEITA.test(t)) return false;
  const resto = semAcento(t.replace(new RegExp(RE_FORMACAO_NAO_ACEITA.source, "gi"), " "));
  // Sobrou outro nome de curso (4+ letras fora do enchimento)? Então há outra formação e passa.
  const outroCurso = resto.split(/[^a-z]+/).some((p) => p.length >= 4 && !ENCHIMENTO.has(p));
  return !outroCurso;
}

export type MotivoInelegivel = "sem_superior" | "formacao_nao_aceita";

/** Por que o lead NÃO pode ir para a sessão — ou `null` se pode. */
export function motivoInelegivel(areaGraduacao: string | null | undefined): MotivoInelegivel | null {
  if (qualificacaoSuperior(areaGraduacao) === "nao") return "sem_superior";
  if (formacaoNaoAceita(areaGraduacao)) return "formacao_nao_aceita";
  return null;
}

/** O lead pode ser convidado para a sessão estratégica? O default é QUALIFICAR. */
export function podeIrParaSessao(areaGraduacao: string | null | undefined): boolean {
  return motivoInelegivel(areaGraduacao) === null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAVA EM CÓDIGO — o gate acima existia só no prompt e o modelo passou por cima.
//
// Amanda (conv 7297, 14/09): formulário "Ensino médio", prompt com "⛔ NÃO convide para a sessão"
// e mesmo assim, quando ela respondeu "Valor" a um follow-up, a IA seguiu o roteiro e perguntou
// "manhã, tarde ou noite?". O objetivo da trilha ("toda resposta termina com um horário") falou
// mais alto que o gate. Prompt contra prompt perde; aqui o convite é barrado antes de sair e a
// tool de agenda recusa marcar.
//
// A exceção do gate continua valendo: se o lead disser NA CONVERSA que tem ou está cursando
// graduação, o formulário estava errado e ele passa.

/** De onde vem a formação: atributo do contato, senão o texto do formulário. */
export function formacaoDoLead(
  atributosContato: Record<string, unknown> | null | undefined,
  dadosFormulario: string | null | undefined,
): string {
  const atributo = atributosContato?.["qual_formacao"];
  if (typeof atributo === "string" && atributo.trim()) return atributo;
  return (dadosFormulario ?? "").match(/Forma[çc][ãa]o:\s*([^\n|]+)/i)?.[1]?.trim() ?? "";
}

const RE_DECLAROU_SUPERIOR =
  /sou formad|me formei|formei em|formad[oa] em|tenho (gradua|faculdade|diploma|curso superior|n[íi]vel superior|ensino superior)|fiz faculdade|graduad[oa] em|bacharel|licenciad[oa]|p[óo]s[- ]gradua/i;

/** O lead contou na conversa que tem ou está cursando graduação? Aí o formulário perde. */
export function leadDeclarouSuperior(mensagensLead: readonly string[]): boolean {
  return mensagensLead.some((m) => RE_CURSANDO.test(m) || RE_DECLAROU_SUPERIOR.test(m));
}

/** O lead está barrado da sessão, considerando formulário E o que ele disse depois? */
export function motivoBloqueioSessao(
  formacao: string | null | undefined,
  mensagensLead: readonly string[],
): MotivoInelegivel | null {
  const motivo = motivoInelegivel(formacao);
  if (!motivo) return null;
  return leadDeclarouSuperior(mensagensLead) ? null : motivo;
}

// A resposta da IA convida para a sessão / pede horário?
const RE_CONVITE_SESSAO = [
  /manh[ãa],? (à|a) tarde ou (à|a) noite/i,
  /(de manh[ãa]|(à|a) tarde|(à|a) noite)\?/i,
  /te encaixar/i,
  /(marcar|agendar) (uma|nossa|a|essa) conversa/i,
  /conversa (est[áa] )?marcada/i,
  /qual (dos )?(hor[áa]rio|dia)s? fica melhor/i,
  /prefere (marcar|conversar)/i,
  /te espero (na |no |hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta)/i,
  /meet\.google\.com/i,
];

export function convidaParaSessao(texto: string): boolean {
  const t = texto ?? "";
  return RE_CONVITE_SESSAO.some((re) => re.test(t));
}

/**
 * O que sai no lugar do convite. Sem travessão, três bolhas no máximo, e a porta aberta: quem
 * está cursando responde e passa. Nada de "não posso te ajudar" seco: o lead sem graduação é
 * lead de daqui a quatro anos, e o Walker quer que ele volte.
 */
export const RESPOSTA_INELEGIVEL: Record<MotivoInelegivel, string> = {
  sem_superior:
    "Vou ser direto com você porque acho que é o mais justo: o concurso de Perito exige graduação, cobrada na posse. " +
    "Então o primeiro passo, antes de qualquer plano de estudo, é começar uma faculdade. " +
    "Se você já estiver cursando alguma, me fala qual que a gente conversa. Se ainda não, quando começar me chama que aí sim eu monto teu plano.",
  formacao_nao_aceita:
    "Vou ser direto com você porque acho que é o mais justo: o curso de Investigação Forense e Perícia Criminal tem o nome da área, mas os editais de Perito não aceitam ele como graduação. " +
    "Então o caminho é uma graduação que os editais aceitem, e isso varia por estado. " +
    "Se você tiver ou estiver cursando outra graduação, me fala qual que a gente conversa. Quando estiver cursando uma, me chama que aí eu monto teu plano.",
};
