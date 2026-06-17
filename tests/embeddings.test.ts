import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmbeddingsClient } from "../src/core/embeddings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: build a minimal OpenAI /v1/embeddings response body. */
function openAiResponse(vector: number[]): object {
  return { data: [{ embedding: vector, index: 0, object: "embedding" }], model: "nomic-text-v1.5", usage: {} };
}

/** Ollama /api/embed response body. */
function ollamaResponse(vector: number[]): object {
  return { model: "nomic-text-v1.5", embeddings: [vector] };
}

/** Single-embedding key format (e.g. some providers). */
function singleEmbeddingResponse(vector: number[]): object {
  return { embedding: vector };
}

type FetchMock = ReturnType<typeof vi.fn>;
type ResolvedValue =
  | { ok: true; json: () => Promise<object> }
  | { ok: false; status: number; text: () => Promise<string> };

function okResponse(body: object): ResolvedValue {
  return { ok: true, json: () => Promise.resolve(body) };
}

function errorResponse(status: number, text: string): ResolvedValue {
  return { ok: false, status, text: () => Promise.resolve(text) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmbeddingsClient", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ── Construction ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("detects Ollama endpoint from URL", () => {
      const ollama = new EmbeddingsClient("http://localhost:11434/api/embed");
      // Indirect check: the request body shape differs between Ollama and OpenAI
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.1])));
      ollama.embed("hello");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:11434/api/embed",
        expect.objectContaining({
          body: JSON.stringify({ model: "nomic-text-v1.5", input: "hello" }),
        }),
      );
    });

    it("detects OpenAI-compatible endpoint from URL", () => {
      const openai = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.1])));
      openai.embed("hello");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/v1/embeddings",
        expect.objectContaining({
          body: JSON.stringify({ input: "hello", model: "nomic-text-v1.5" }),
        }),
      );
    });

    it("uses default model when none given", () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.1])));
      client.embed("hello");
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ input: "hello", model: "nomic-text-v1.5" }),
        }),
      );
    });
  });

  // ── Cache hit / miss ──────────────────────────────────────────────────

  describe("cache hit / miss", () => {
    it("returns vector from API on cache miss", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.5, 0.6, 0.7])));

      const result = await client.embed("hello");
      expect(result).toEqual([0.5, 0.6, 0.7]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns cached vector on subsequent call without fetching", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.5, 0.6, 0.7])));

      const first = await client.embed("hello");
      const second = await client.embed("hello");

      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1); // only the first call hit the API
    });

    it("treats different strings as separate cache entries", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock
        .mockResolvedValueOnce(okResponse(singleEmbeddingResponse([0.1, 0.2])))
        .mockResolvedValueOnce(okResponse(singleEmbeddingResponse([0.9, 0.8])));

      const a = await client.embed("alpha");
      const b = await client.embed("beta");

      expect(a).toEqual([0.1, 0.2]);
      expect(b).toEqual([0.9, 0.8]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── Response format parsing ───────────────────────────────────────────

  describe("response format parsing", () => {
    it("parses OpenAI format (data[i].embedding)", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(openAiResponse([0.1, 0.2, 0.3])));

      const result = await client.embed("hello");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("parses Ollama format (embeddings[i])", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/api/embed");
      fetchMock.mockResolvedValue(okResponse(ollamaResponse([0.4, 0.5, 0.6])));

      const result = await client.embed("hello");
      expect(result).toEqual([0.4, 0.5, 0.6]);
    });

    it("parses single embedding format (embedding key)", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.7, 0.8, 0.9])));

      const result = await client.embed("hello");
      expect(result).toEqual([0.7, 0.8, 0.9]);
    });

    it("throws on unrecognised response shape", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse({ unexpected: true }));

      await expect(client.embed("hello")).rejects.toThrow("Unexpected embedding response format");
    });

    it("throws on HTTP error status", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(errorResponse(400, "Bad Request"));

      await expect(client.embed("hello")).rejects.toThrow("Embedding failed: 400 Bad Request");
    });

    it("throws on server error status", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(errorResponse(500, "Internal Server Error"));

      await expect(client.embed("hello")).rejects.toThrow("Embedding failed: 500 Internal Server Error");
    });
  });

  // ── Cache eviction (maxCache = 512) ──────────────────────────────────

  describe("cache eviction", () => {
    it("evicts oldest entry when cache reaches maxCache (512)", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      // Fill cache with 513 unique strings (indices 0..512)
      // Strings "evict-0" through "evict-512" => 513 entries
      const strings: string[] = [];
      for (let i = 0; i <= 512; i++) {
        strings.push(`evict-${i}`);
      }

      // Each call gets a distinct vector
      fetchMock.mockImplementation((_url: string, opts?: { body?: string }) => {
        const body = opts?.body ? JSON.parse(opts.body) : {};
        const input = body.input ?? "unknown";
        // Derive a vector from the input so we can verify which stayed
        const idx = parseInt((input as string).replace("evict-", ""), 10) || 0;
        const vector = [idx, idx + 1, idx + 2];
        return Promise.resolve(okResponse(singleEmbeddingResponse(vector)));
      });

      // Embed all 513 strings
      for (const s of strings) {
        await client.embed(s);
      }

      // The cache should have 512 entries — "evict-0" was evicted
      // Re-embed "evict-0" — should be a cache miss (call to fetch)
      fetchMock.mockClear();
      await client.embed("evict-0");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Re-embed "evict-512" — should be a cache hit (no fetch)
      fetchMock.mockClear();
      await client.embed("evict-512");
      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it("evicts oldest entry first (FIFO)", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([1, 2, 3])));

      // Fill cache with 512 entries
      for (let i = 0; i < 512; i++) {
        await client.embed(`key-${i}`);
      }

      // Now add one more — "key-0" is evicted
      await client.embed("overflow");

      fetchMock.mockClear();

      // "key-0" was evicted — should be a miss
      await client.embed("key-0");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // "key-0" re-insertion evicted "key-1" (now the oldest), so "key-1" is also a miss
      fetchMock.mockClear();
      await client.embed("key-1");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // "key-511" was inserted 2nd-to-last and should still be a hit
      fetchMock.mockClear();
      await client.embed("key-511");
      expect(fetchMock).toHaveBeenCalledTimes(0);

      // "overflow" was inserted last and should be a hit
      fetchMock.mockClear();
      await client.embed("overflow");
      expect(fetchMock).toHaveBeenCalledTimes(0);
    });
  });

  // ── TTL expiry ───────────────────────────────────────────────────────

  describe("TTL expiry", () => {
    it("serves from cache before TTL, refetches after", async () => {
      vi.useFakeTimers();
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.1, 0.2])));

      // First call — cache miss
      const first = await client.embed("hello");
      expect(first).toEqual([0.1, 0.2]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance time by 1 ms — still within cache TTL (300_000 ms)
      await vi.advanceTimersByTimeAsync(1);
      const cached = await client.embed("hello");
      expect(cached).toEqual([0.1, 0.2]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance time past TTL (300_000 ms)
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.9, 0.8])));
      await vi.advanceTimersByTimeAsync(300_000);
      const refetched = await client.embed("hello");
      expect(refetched).toEqual([0.9, 0.8]); // new value from API
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not serve expired cache entries", async () => {
      vi.useFakeTimers();
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.1, 0.2])));

      await client.embed("hello");
      // Advance exactly to TTL boundary (300_000 ms) — cache still valid
      await vi.advanceTimersByTimeAsync(300_000 - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // One more ms and it's expired
      await vi.advanceTimersByTimeAsync(1);
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.3, 0.4])));
      await client.embed("hello");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── clearCache ────────────────────────────────────────────────────────

  describe("clearCache", () => {
    it("clears all cached entries", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([1, 2])));

      await client.embed("a");
      await client.embed("b");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      client.clearCache();

      // Both should be cache misses now
      fetchMock.mockClear();
      await client.embed("a");
      await client.embed("b");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not throw when cache is already empty", () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      expect(() => client.clearCache()).not.toThrow();
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty string input", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([])));
      const result = await client.embed("");
      expect(result).toEqual([]);
    });

    it("handles zero-length vector from API", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([])));
      const result = await client.embed("hello");
      expect(result).toEqual([]);
    });

    it("caches even zero-length vectors", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([])));

      await client.embed("hello");
      fetchMock.mockClear();
      await client.embed("hello");
      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    it("handles special characters in input text", async () => {
      const client = new EmbeddingsClient("http://localhost:8080/v1/embeddings");
      fetchMock.mockResolvedValue(okResponse(singleEmbeddingResponse([0.42])));
      const result = await client.embed("héllo wörld 🎉 \n\t");
      expect(result).toEqual([0.42]);
    });
  });
});
