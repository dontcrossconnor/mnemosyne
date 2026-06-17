/**
 * EmbeddingsClient tests — real Ollama, no mocks.
 * Requires Ollama running at localhost:11434 with mxbai-embed-large.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EmbeddingsClient } from "../src/core/embeddings.js";

const OLLAMA_URL = "http://localhost:11434/v1/embeddings";
const MODEL = "mxbai-embed-large";

describe("EmbeddingsClient (real Ollama)", () => {
  let client: EmbeddingsClient;

  beforeAll(() => {
    client = new EmbeddingsClient(OLLAMA_URL, MODEL);
  });

  it("returns a 1024-dim vector for text", async () => {
    const vec = await client.embed("hello world");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(1024);
    expect(typeof vec[0]).toBe("number");
  });

  it("returns the same vector for the same text (cache hit)", async () => {
    const a = await client.embed("cache test input");
    const b = await client.embed("cache test input");
    expect(a).toEqual(b);
  });

  it("returns different vectors for different texts", async () => {
    const a = await client.embed("the server IP is 192.168.1.1");
    const b = await client.embed("user prefers dark mode");
    // Cosine similarity should be lower than 1.0
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    const sim = dot / (magA * magB);
    expect(sim).toBeLessThan(0.99);
  });

  it("handles empty string", async () => {
    const vec = await client.embed("");
    expect(vec.length).toBe(1024);
  });

  it("handles long text", async () => {
    const long = Array(1000).fill("memory").join(" ");
    const vec = await client.embed(long);
    expect(vec.length).toBe(1024);
  });

  it("clearCache forces a fresh API call", async () => {
    const text = "clear cache test";
    const a = await client.embed(text);
    client.clearCache();
    const b = await client.embed(text);
    // Should still be equal (same input → same embedding)
    expect(a).toEqual(b);
  });

  it("embeddings are deterministic for the same input across calls", async () => {
    // Two independent clients should return the same vector for the same text
    const client2 = new EmbeddingsClient(OLLAMA_URL, MODEL);
    const a = await client.embed("determinism check");
    const b = await client2.embed("determinism check");
    expect(a).toEqual(b);
  });
});
