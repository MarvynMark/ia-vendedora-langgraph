// Dispara o áudio de recuperação do Walker numa conversa (teste manual).
// Uso: bun run src/scripts/testar-audio-walker.ts <idConversa> [idConta]
// A janela de 24h da conversa precisa estar aberta (mídia livre só entrega dentro dela).
import { env } from "../config/env.ts";
import { AUDIO_WALKER_POSPRECO_URL, enviarAudioPorUrl } from "../tools/enviar-audio-walker.ts";

const idConversa = process.argv[2];
const idConta = process.argv[3] ?? env.CHATWOOT_ACCOUNT_ID;

if (!idConversa) {
  console.error("Uso: bun run src/scripts/testar-audio-walker.ts <idConversa> [idConta]");
  process.exit(1);
}
if (!AUDIO_WALKER_POSPRECO_URL) {
  console.error("AUDIO_WALKER_POSPRECO_URL está vazia — nada a enviar.");
  process.exit(1);
}

console.log(`Enviando áudio do Walker → conta ${idConta}, conversa ${idConversa}`);
console.log(`URL: ${AUDIO_WALKER_POSPRECO_URL}`);
await enviarAudioPorUrl(idConta, idConversa, AUDIO_WALKER_POSPRECO_URL, "walker-posprecoo.ogg");
console.log("✅ Áudio enviado (como nota de voz). Confira no WhatsApp/Chatwoot.");
