import { criarGrafoAgenteClinica } from "./graphs/main-agent/graph.ts";
import { criarGrafoFollowUp } from "./graphs/follow-up/graph.ts";

async function main() {
  // Main Agent Graph
  const mainGraph = await criarGrafoAgenteClinica();
  const mainPng = await mainGraph.getGraph().drawMermaidPng();
  const mainBuffer = new Uint8Array(await mainPng.arrayBuffer());
  await Bun.write("main-agent.png", mainBuffer);
  console.log("Gerado: main-agent.png");

  // Follow-up Graph
  const followUpGraph = await criarGrafoFollowUp();
  const followUpPng = await followUpGraph.getGraph().drawMermaidPng();
  const followUpBuffer = new Uint8Array(await followUpPng.arrayBuffer());
  await Bun.write("follow-up.png", followUpBuffer);
  console.log("Gerado: follow-up.png");
}

main().catch(console.error);
