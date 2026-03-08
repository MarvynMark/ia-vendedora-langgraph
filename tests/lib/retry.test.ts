import { describe, test, expect, mock } from "bun:test";
import { comRetry } from "../../src/lib/retry.ts";

describe("comRetry", () => {
  test("returns value on first success", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await comRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on failure and succeeds", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("fail"));
      return Promise.resolve("success");
    });
    const result = await comRetry(fn, 3, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("throws after max retries", async () => {
    const fn = mock(() => Promise.reject(new Error("always fails")));
    await expect(comRetry(fn, 3, 1)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("uses default 3 retries", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));
    await expect(comRetry(fn, 3, 1)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
