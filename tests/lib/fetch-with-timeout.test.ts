import { describe, test, expect, mock, beforeEach } from "bun:test";
import { fetchComTimeout } from "../../src/lib/fetch-with-timeout.ts";

describe("fetchComTimeout", () => {
  test("returns response on success", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const mockFetch = mock(() => Promise.resolve(mockResponse));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const res = await fetchComTimeout("http://example.com");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("passes options to fetch", async () => {
    const mockResponse = new Response("{}", { status: 201 });
    const mockFetch = mock(() => Promise.resolve(mockResponse));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await fetchComTimeout("http://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { signal?: AbortSignal }];
    expect(url).toBe("http://example.com");
    expect((opts as RequestInit).method).toBe("POST");
    expect((opts as { signal?: AbortSignal }).signal).toBeDefined();
  });

  test("aborts on timeout", async () => {
    let aborted = false;
    const mockFetch = mock((_url: string, opts: RequestInit & { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(
      fetchComTimeout("http://example.com", { timeout: 10 }),
    ).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
