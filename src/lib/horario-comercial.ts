// São Paulo é UTC-3 fixo (Brasil aboliu horário de verão em 2019).
// Convenção: horário SP = horário UTC + SP_OFFSET_MS (offset negativo).
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

// Janela de envio de follow-ups: 9h às 18h (horário de São Paulo), seg-sex.
const HORA_ABERTURA = 9;
const HORA_FECHAMENTO = 18;
const HORA_REABERTURA = 9; // hora para reagendar quando cai fora do intervalo permitido

function getComponentesSP(date: Date): { hora: number; diaSemana: number } {
  // Para ler a hora de PAREDE em SP a partir de um instante UTC, soma o offset (negativo).
  const spTime = new Date(date.getTime() + SP_OFFSET_MS);
  return {
    hora: spTime.getUTCHours(),
    diaSemana: spTime.getUTCDay(), // 0=dom, 6=sab
  };
}

function ehFimDeSemana(diaSemana: number): boolean {
  return diaSemana === 0 || diaSemana === 6;
}

/**
 * Dado um momento e um delay em ms, retorna quando a mensagem deve ser
 * enviada respeitando horário comercial (seg-sex, 9h-18h, fuso SP).
 * Se o alvo cair fora desse intervalo, avança para o próximo dia útil às 9h.
 *
 * @param horaFechamento - hora máxima (padrão 18).
 */
export function proximoHorarioComercial(agora: Date, delayMs: number, horaFechamento = HORA_FECHAMENTO): Date {
  const alvo = new Date(agora.getTime() + delayMs);
  const { hora, diaSemana } = getComponentesSP(alvo);

  // Já está dentro do expediente
  if (!ehFimDeSemana(diaSemana) && hora >= HORA_ABERTURA && hora < horaFechamento) {
    return alvo;
  }

  // Trabalhar na "hora de parede SP" (UTC + offset) para manipular os componentes direto.
  const spTime = new Date(alvo.getTime() + SP_OFFSET_MS);

  if (!ehFimDeSemana(diaSemana) && hora < HORA_ABERTURA) {
    // Antes do expediente: mesmo dia às 9h
    spTime.setUTCHours(HORA_REABERTURA, 0, 0, 0);
  } else {
    // Após o expediente ou fim de semana: próximo dia às 9h
    spTime.setUTCDate(spTime.getUTCDate() + 1);
    spTime.setUTCHours(HORA_REABERTURA, 0, 0, 0);
    // Pular sábado e domingo
    while (ehFimDeSemana(spTime.getUTCDay())) {
      spTime.setUTCDate(spTime.getUTCDate() + 1);
    }
  }

  // Converter de volta para UTC real (desfaz o offset aplicado).
  return new Date(spTime.getTime() - SP_OFFSET_MS);
}
