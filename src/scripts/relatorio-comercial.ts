// Relatório diário do grupo do comercial, sob demanda.
//
// Uso: bun run src/scripts/relatorio-comercial.ts            → só imprime (não envia nada)
//      bun run src/scripts/relatorio-comercial.ts --enviar   → manda no grupo do comercial

import { gerarRelatorioComercial, enviarRelatorioComercial } from "../lib/relatorio-comercial.ts";

const mensagens = await gerarRelatorioComercial();
console.log(mensagens.join("\n\n────────\n\n"));
if (process.argv.includes("--enviar")) {
  await enviarRelatorioComercial(mensagens);
  console.log("\n✅ Enviado ao grupo do comercial.");
}
process.exit(0);
