/**
 * Rastreio de processamentos em andamento, para desligamento gracioso (graceful shutdown).
 *
 * O webhook responde 202 na hora e processa o turno em BACKGROUND (`void processamento`).
 * Num redeploy, o Coolify manda SIGTERM: sem controle, o processo morre no meio de um
 * turno — deixa o lock preso e a mensagem do lead sem resposta (órfã invisível, já que a
 * fila foi consumida). Este módulo permite, no SIGTERM, parar de aceitar novos webhooks e
 * ESPERAR os turnos ativos terminarem antes de encerrar.
 */
import { logger } from "./logger.ts";

let ativos = 0;
let encerrando = false;
const aoDrenar: Array<() => void> = [];

/** True depois que o SIGTERM começou o desligamento — novos webhooks devem recusar. */
export function estaEncerrando(): boolean {
  return encerrando;
}

export function marcarEncerrando(): void {
  encerrando = true;
}

export function processamentosAtivos(): number {
  return ativos;
}

/**
 * Envolve a promise de um turno em background. Incrementa o contador enquanto roda e
 * decrementa ao terminar (sucesso ou erro). Retorna a mesma promise para encadeamento.
 */
export function rastrear<T>(p: Promise<T>): Promise<T> {
  ativos++;
  void p.finally(() => {
    ativos--;
    if (ativos === 0) {
      // Notifica quem espera o dreno e zera a lista (splice) para não chamar de novo.
      for (const fn of aoDrenar.splice(0)) fn();
    }
  });
  return p;
}

/**
 * Espera todos os turnos ativos terminarem, ou o timeout estourar.
 * @returns true se drenou tudo a tempo; false se estourou o timeout.
 */
export async function aguardarDrenar(timeoutMs: number): Promise<boolean> {
  if (ativos === 0) return true;
  logger.info("shutdown", `aguardando ${ativos} turno(s) ativo(s) drenarem (timeout ${Math.round(timeoutMs / 1000)}s)`);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    aoDrenar.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
