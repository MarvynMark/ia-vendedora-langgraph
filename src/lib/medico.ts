// Detecção DETERMINÍSTICA de médico → trilha Médico Legista.
//
// Estava duplicada em três lugares (prompt do agente principal, grafo de follow-up e agora o gate
// de material), sempre com o mesmo risco: um typo na formação ("Mediciba", conv 4549) fazia o
// gate falhar e o lead médico cair no pitch genérico de Perito Criminal. Centralizado aqui para
// que os três leiam a mesma regra.

const normalizar = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Formação contém "medic" (pega typos como "Mediciba"), exceto biomedicina e veterinária.
 */
export function ehMedicoPorFormacao(formacao: string | null | undefined): boolean {
  const f = normalizar(formacao);
  return /medic/.test(f) && !/biomedic/.test(f) && !/veterin/.test(f);
}

/** Lê o campo "Formação: X" da string de dados do formulário ("Campo: Valor | Campo: Valor"). */
export function formacaoDoFormulario(dadosFormulario: string | null | undefined): string {
  return /(?:^|\|)\s*Forma[çc][ãa]o:\s*([^|]+)/i.exec(dadosFormulario ?? "")?.[1] ?? "";
}

/**
 * Autoritativo pela label "medico" (que o cadastro seta com a mesma lógica tolerante a typo).
 * Fallbacks: a formação do formulário e o custom_attribute `qual_formacao` do Chatwoot — leads
 * importados/antigos não estão em leads_formulario_mentoria (ex.: tag "IMLC RETROATIVO") e sem
 * essa segunda fonte o gate falhava.
 */
export function ehMedicoLead(ctx: {
  etiquetas?: string[];
  dadosFormulario?: string;
  atributosContato?: Record<string, unknown>;
}): boolean {
  if ((ctx.etiquetas ?? []).includes("medico")) return true;
  if (ehMedicoPorFormacao(formacaoDoFormulario(ctx.dadosFormulario))) return true;
  return ehMedicoPorFormacao(ctx.atributosContato?.["qual_formacao"] as string | undefined);
}
