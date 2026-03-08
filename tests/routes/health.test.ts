import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { healthRouter } from "../../src/routes/health.ts";

const app = new Elysia().use(healthRouter);

describe("GET /health", () => {
  test("retorna status ok", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
  });

  test("retorna timestamp ISO 8601", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    const body = await res.json() as { status: string; timestamp: string };
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
