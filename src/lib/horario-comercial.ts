// São Paulo é UTC-3 fixo (Brasil aboliu horário de verão em 2019).
// Convenção: horário SP = horário UTC + SP_OFFSET_MS (offset negativo).
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

// Janela de envio de follow-ups: 08h20 às 20h (horário de São Paulo), seg-sex.
// A abertura às 08:20 é o horário em que o Pedro (comercial) já consegue acompanhar,
// então o primeiro follow-up da manhã sai a partir daí. O fechamento às 20h permite
// recuperar no mesmo dia quem some no fim da tarde (a janela grátis de 24h do WhatsApp
// segue aberta à noite), em vez de jogar o toque só pra manhã seguinte.
const HORA_ABERTURA = 8;
const MINUTO_ABERTURA = 20;
const HORA_FECHAMENTO = 20;
const HORA_REABERTURA = 8; // hora para reagendar quando cai fora do intervalo permitido
const MINUTO_REABERTURA = 20;

// Janela do PRIMEIRO contato (intro do Walker e template de abertura) — mais larga e TODOS OS DIAS.
// Ela é diferente da janela de follow-up de propósito: o lead acabou de preencher o formulário e
// está com o celular na mão, então responder em minutos é o que converte; represar até o próximo
// dia útil é o que mata. Medido em 31/08/26: com a janela de follow-up aplicada aqui (seg-sex
// 08h20-20h), os leads de sábado e domingo esperaram de 36 a 50h e o fim de semana fechou sem
// nenhuma venda. Além disso, 21% dos leads chegam DEPOIS das 20h — 21h é o pico de captação do dia.
// Os 12,5% que chegam de madrugada seguem esperando: mensagem às 3h da manhã queima o lead.
const HORA_ABERTURA_PRIMEIRO_CONTATO = 7;
const HORA_FECHAMENTO_PRIMEIRO_CONTATO = 24; // até 23:59

function getComponentesSP(date: Date): { hora: number; minuto: number; diaSemana: number } {
  // Para ler a hora de PAREDE em SP a partir de um instante UTC, soma o offset (negativo).
  const spTime = new Date(date.getTime() + SP_OFFSET_MS);
  return {
    hora: spTime.getUTCHours(),
    minuto: spTime.getUTCMinutes(),
    diaSemana: spTime.getUTCDay(), // 0=dom, 6=sab
  };
}

function ehFimDeSemana(diaSemana: number): boolean {
  return diaSemana === 0 || diaSemana === 6;
}

// Antes da abertura da janela (08:20)?
function antesDaAbertura(hora: number, minuto: number): boolean {
  return hora < HORA_ABERTURA || (hora === HORA_ABERTURA && minuto < MINUTO_ABERTURA);
}

// Dentro da janela útil (>= 08:20 e < horaFechamento), em dia útil?
function dentroDaJanela(hora: number, minuto: number, diaSemana: number, horaFechamento: number): boolean {
  return !ehFimDeSemana(diaSemana) && !antesDaAbertura(hora, minuto) && hora < horaFechamento;
}

/**
 * A data cai DENTRO da janela de envio (seg-sex, 08h20-20h, fuso SP)?
 * Use para decidir se uma mensagem iniciada pela IA (abertura, intro do Walker) pode sair
 * AGORA ou deve esperar a próxima passada do cron dentro do expediente — evita disparos de
 * madrugada. Os follow-ups já respeitam o horário via `proximoHorarioComercial` no agendamento;
 * esta função cobre os disparos imediatos (crons de template/intro) que não agendam por due_date.
 */
export function estaDentroDaJanela(date: Date = new Date(), horaFechamento = HORA_FECHAMENTO): boolean {
  const { hora, minuto, diaSemana } = getComponentesSP(date);
  return dentroDaJanela(hora, minuto, diaSemana, horaFechamento);
}

/**
 * A data cai dentro da janela do PRIMEIRO CONTATO (07h-23h59, TODOS os dias, fuso SP)?
 * Use só para a intro do Walker e o template de abertura — mensagens disparadas logo depois de o
 * lead preencher o formulário. Fim de semana entra: o lead que aplica no sábado precisa ser
 * atendido no sábado. Para follow-up e recuperação continue usando `estaDentroDaJanela`.
 */
export function estaDentroDaJanelaPrimeiroContato(date: Date = new Date()): boolean {
  const { hora } = getComponentesSP(date);
  return hora >= HORA_ABERTURA_PRIMEIRO_CONTATO && hora < HORA_FECHAMENTO_PRIMEIRO_CONTATO;
}

/**
 * Dado um momento e um delay em ms, retorna quando a mensagem deve ser
 * enviada respeitando horário comercial (seg-sex, 08h20-18h, fuso SP).
 * Se o alvo cair fora desse intervalo, avança para o próximo dia útil às 08:20.
 *
 * @param horaFechamento - hora máxima (padrão 18).
 */
export function proximoHorarioComercial(agora: Date, delayMs: number, horaFechamento = HORA_FECHAMENTO): Date {
  const alvo = new Date(agora.getTime() + delayMs);
  const { hora, minuto, diaSemana } = getComponentesSP(alvo);

  // Já está dentro do expediente
  if (dentroDaJanela(hora, minuto, diaSemana, horaFechamento)) {
    return alvo;
  }

  // Trabalhar na "hora de parede SP" (UTC + offset) para manipular os componentes direto.
  const spTime = new Date(alvo.getTime() + SP_OFFSET_MS);

  if (!ehFimDeSemana(diaSemana) && antesDaAbertura(hora, minuto)) {
    // Antes do expediente: mesmo dia às 08:20
    spTime.setUTCHours(HORA_REABERTURA, MINUTO_REABERTURA, 0, 0);
  } else {
    // Após o expediente ou fim de semana: próximo dia às 08:20
    spTime.setUTCDate(spTime.getUTCDate() + 1);
    spTime.setUTCHours(HORA_REABERTURA, MINUTO_REABERTURA, 0, 0);
    // Pular sábado e domingo
    while (ehFimDeSemana(spTime.getUTCDay())) {
      spTime.setUTCDate(spTime.getUTCDate() + 1);
    }
  }

  // Converter de volta para UTC real (desfaz o offset aplicado).
  return new Date(spTime.getTime() - SP_OFFSET_MS);
}

/**
 * Maximiza o uso da janela GRÁTIS de 24h do WhatsApp ao agendar o próximo follow-up.
 *
 * A janela de 24h é um prazo fixo (última mensagem do lead + 24h); dentro dela o envio
 * é gratuito, fora exige template pago da Meta. Dado o delay "ideal" da cadência e quanto
 * ainda resta da janela (`msRestantesJanela`), decide quando disparar o próximo toque:
 *
 * - Sem janela (`msRestantesJanela <= 0`): agenda normal — o toque cairá no template pago.
 * - Se o toque ideal já cai DENTRO da janela: mantém (já é grátis).
 * - Se o toque ideal FURARIA a janela: adianta para pouco antes do fechamento (ainda grátis),
 *   respeitando horário comercial (08h20-18h) e um espaçamento mínimo anti-spam (`minGapMs`).
 * - Se não dá pra enviar grátis a tempo (janela fecha fora do expediente e não sobra
 *   expediente hoje, ou o espaçamento mínimo não cabe): agenda normal (template pago).
 */
export function agendarMaximizandoJanela(
  agora: Date,
  delayIdealMs: number,
  msRestantesJanela: number,
  opts: { minGapMs?: number; margemMs?: number; horaFechamento?: number } = {},
): Date {
  const minGapMs = opts.minGapMs ?? 60 * 60 * 1000; // 1h anti-spam entre toques
  const margemMs = opts.margemMs ?? 30 * 60 * 1000; // dispara 30min antes de fechar (folga p/ cron)
  const horaFechamento = opts.horaFechamento ?? HORA_FECHAMENTO;

  const idealDate = proximoHorarioComercial(agora, delayIdealMs, horaFechamento);

  // Sem janela grátis: nada a otimizar, segue o fluxo normal (cai no template pago).
  if (msRestantesJanela <= 0) return idealDate;

  const fechamento = agora.getTime() + msRestantesJanela;

  // O toque ideal já cai dentro da janela → já é grátis, mantém.
  if (idealDate.getTime() < fechamento) return idealDate;

  const pisoGap = agora.getTime() + minGapMs;

  // Alvo: último instante útil pouco antes de a janela fechar.
  const alvo = fechamento - margemMs;
  if (alvo >= pisoGap) {
    const { hora, minuto, diaSemana } = getComponentesSP(new Date(alvo));
    if (dentroDaJanela(hora, minuto, diaSemana, horaFechamento)) {
      return new Date(alvo);
    }
  }

  // Janela fecha fora do expediente. Se ainda estamos em expediente HOJE e a janela só
  // fecha depois, dispara perto do fim do expediente de hoje (ainda dentro da janela = grátis).
  const compAgora = getComponentesSP(agora);
  if (dentroDaJanela(compAgora.hora, compAgora.minuto, compAgora.diaSemana, horaFechamento)) {
    const spNow = new Date(agora.getTime() + SP_OFFSET_MS);
    spNow.setUTCHours(horaFechamento, 0, 0, 0);
    const fimExpedienteHoje = spNow.getTime() - SP_OFFSET_MS - margemMs;
    if (fimExpedienteHoje >= pisoGap && fimExpedienteHoje < fechamento) {
      return new Date(fimExpedienteHoje);
    }
  }

  // Não deu pra manter grátis → agenda normal (template pago).
  return idealDate;
}
