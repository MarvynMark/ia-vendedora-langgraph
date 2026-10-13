// Concursos disponíveis no corretor. Para lançar um concurso novo: criar a pasta do perfil
// (instruções, metodologia, conteúdo, banco) e registrá-lo aqui.
import type { PerfilConcurso } from "../tipos.ts";
import { perfilPcdf } from "./pcdf/perfil.ts";

export const PERFIS: PerfilConcurso[] = [perfilPcdf];

export function buscarPerfil(codigo: string | null | undefined): PerfilConcurso | null {
  if (!codigo) return null;
  return PERFIS.find((p) => p.codigo === codigo.toLowerCase()) ?? null;
}
