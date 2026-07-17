import { Elysia } from "elysia";

// Commit em execução, resolvido UMA vez no boot. Ordem de fallback:
// 1) env injetada pelo build/deploy (Coolify: SOURCE_COMMIT; genéricas: GIT_COMMIT/GIT_SHA)
// 2) git rev-parse (funciona em dev e em builds que mantêm o .git)
// 3) "unknown" (container sem .git nem env — o /health ainda responde)
function resolverCommit(): string {
  const daEnv =
    process.env["SOURCE_COMMIT"] ??
    process.env["GIT_COMMIT"] ??
    process.env["GIT_SHA"];
  if (daEnv) return daEnv.slice(0, 7);
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

const COMMIT = resolverCommit();

export const healthRouter = new Elysia()
  .get("/health", () => ({
    status: "ok",
    commit: COMMIT,
    uptimeSegundos: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));
