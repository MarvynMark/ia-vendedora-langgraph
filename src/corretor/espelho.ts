// Espelho EXIGIDO por enunciado, montado UMA vez e reaproveitado. Antes, a IA montava o espelho
// junto com a correção, já lendo a resposta: a mesma resposta ganhou 23,60 e 21,50 porque numa
// rodada o "cenário ligado e conectado" virou item exigido e na outra, aprofundamento.
import { createHash } from "node:crypto";
import { logger } from "../lib/logger.ts";
import { type ItemEspelho, montarEspelhoPorMaioria } from "./ia.ts";
import { normalizar } from "./regras.ts";
import { buscarEspelhoSalvo, salvarEspelho } from "./sessao.ts";
import type { PerfilConcurso } from "./tipos.ts";

export function chaveEspelho(perfil: PerfilConcurso, enunciado: string): string {
  return createHash("sha256").update(`${perfil.codigo}|${normalizar(enunciado)}`).digest("hex");
}

/** Espelho salvo do enunciado, ou monta e salva. Sem banco, monta mesmo assim (só não reaproveita). */
export async function obterEspelhoExigido(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const chave = chaveEspelho(perfil, enunciado);
  try {
    const salvo = await buscarEspelhoSalvo(chave);
    if (salvo?.length && salvo.every((i) => i.atendidoSe)) return salvo as ItemEspelho[];
  } catch (e) {
    logger.warn("corretor", "Sem cache de espelho (banco indisponível); montando na hora", e);
  }
  const itens = await montarEspelhoPorMaioria(perfil, enunciado);
  try {
    await salvarEspelho(chave, perfil.codigo, enunciado, itens);  // ON CONFLICT: ver salvarEspelho
  } catch (e) {
    logger.warn("corretor", "Falha ao salvar espelho", e);
  }
  return itens;
}
