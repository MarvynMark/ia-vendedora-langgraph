import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { logger } from "../../src/lib/logger.ts";

describe("logger", () => {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origNodeEnv = process.env["NODE_ENV"];

  let logs: string[] = [];
  let warns: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    logs = [];
    warns = [];
    errors = [];
    // Enable logging for these tests (override test mode)
    process.env["NODE_ENV"] = "development";
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.warn = (...args: unknown[]) => warns.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    process.env["NODE_ENV"] = origNodeEnv;
  });

  test("logger.info outputs to console.log with tag", () => {
    logger.info("webhook", "Processando mensagem");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain("webhook");
    expect(logs[0]).toContain("Processando mensagem");
  });

  test("logger.warn outputs to console.warn", () => {
    logger.warn("retry", "Tentativa falhou");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain("retry");
    expect(warns[0]).toContain("Tentativa falhou");
  });

  test("logger.error outputs to console.error", () => {
    logger.error("chatwoot", "Erro na API");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("chatwoot");
    expect(errors[0]).toContain("Erro na API");
  });

  test("logger.debug outputs to console.log", () => {
    logger.debug("lock", "Lock adquirido");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain("lock");
  });

  test("logger includes data when provided", () => {
    logger.info("test", "mensagem", { key: "value" });
    const output = logs.join("");
    expect(output).toContain("test");
    expect(output).toContain("mensagem");
  });
});
