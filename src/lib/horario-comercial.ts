// São Paulo é UTC-3 fixo (Brasil aboliu horário de verão em 2019)
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

const HORA_ABERTURA = 8;
const HORA_FECHAMENTO = 18;
const HORA_REABERTURA = 9; // hora para reagendar quando cai fora do expediente

function getComponentesSP(date: Date): { hora: number; diaSemana: number } {
  const spTime = new Date(date.getTime() - SP_OFFSET_MS);
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
 * enviada respeitando horário comercial (seg-sex, 8h-18h, fuso SP).
 * Se o alvo cair fora desse intervalo, avança para o próximo dia útil às 9h.
 */
export function proximoHorarioComercial(agora: Date, delayMs: number): Date {
  const alvo = new Date(agora.getTime() + delayMs);
  const { hora, diaSemana } = getComponentesSP(alvo);

  // Já está dentro do expediente
  if (!ehFimDeSemana(diaSemana) && hora >= HORA_ABERTURA && hora < HORA_FECHAMENTO) {
    return alvo;
  }

  // Trabalhar em "SP time UTC" para manipular sem conversão de offset a cada passo
  const spTime = new Date(alvo.getTime() - SP_OFFSET_MS);

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

  // Converter de volta para UTC real
  return new Date(spTime.getTime() + SP_OFFSET_MS);
}
