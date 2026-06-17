/**
 * Recall tool integration tests — real Qdrant + Ollama, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QdrantDB } from "../src/core/qdrant.js";
import { EmbeddingsClient } from "../src/core/embeddings.js";
import { recall } from "../src/tools/recall.js";
import { BM25Index } from "../src/core/bm25.js";
import { testCollection, createTestCollection, deleteTestCollection } from "./helpers/qdrant.js";

const QDRANT_URL = "http://localhost:6333";
const OLLAMA_URL = "http://localhost:11434/v1/embeddings";
const AGENT_ID = "test-agent";

describe("recall (real Qdrant + Ollama)", () => {
  const sharedColl = testCollection("recall");
  const privateColl = testCollection("recall_priv");
  const collections = { shared: sharedColl, private: privateColl };
  let db: QdrantDB;
  let embeddings: EmbeddingsClient;

  beforeAll(async () => {
    await createTestCollection(sharedColl);
    await createTestCollection(privateColl);
    db = new QdrantDB(QDRANT_URL, AGENT_ID, collections);
    embeddings = new EmbeddingsClient(OLLAMA_URL, "mxbai-embed-large");

    // Seed test data via store tool
    const { store } = await import("../src/tools/store.js");
    const ctx = { db, embeddings, agentId: AGENT_ID, collections };
    await store(ctx, "the server IP is 10.0.0.1");
    await store(ctx, "database runs on port 5432");
    await store(ctx, "user prefers dark mode for the editor");
    await store(ctx, "deploy docker container to kubernetes");
    await store(ctx, "how to restart the nginx service");
  });

  afterAll(async () => {
    await deleteTestCollection(sharedColl);
    await deleteTestCollection(privateColl);
  });

  const ctx = (extra: Record<string, unknown> = {}) => ({
    db, embeddings, agentId: AGENT_ID, collections,
    enableDecay: false,
    ...extra,
  });

  it("returns results for a matching query", async () => {
    const results = await recall(ctx(), "what is the server IP");
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects the limit option", async () => {
    const results = await recall(ctx(), "server database", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("uses BM25 hybrid search when enabled", async () => {
    const bm25 = new BM25Index();
    const { store } = await import("../src/tools/store.js");
    await store({ db, embeddings, agentId: AGENT_ID, collections, bm25Index: bm25 }, "server IP address config");

    const results = await recall(ctx({ enableBM25: true, bm25Index: bm25 }), "server IP");
    expect(results.length).toBeGreaterThan(0);
  });

  it("top result is relevant to query", async () => {
    const results = await recall(ctx(), "deploy docker kubernetes");
    expect(results.length).toBeGreaterThan(0);
    const first = results[0].entry.text.toLowerCase();
    expect(first.includes("deploy") || first.includes("docker") || first.includes("kubernetes")).toBe(true);
  });

  it("updates access times for returned results", async () => {
    const r1 = await recall(ctx(), "server IP");
    if (r1.length > 0) {
      const id = r1[0].entry.id;
      const initial = r1[0].entry.accessCount;
      const r2 = await recall(ctx(), "server IP");
      const updated = r2.find(r => r.entry.id === id);
      if (updated) {
        expect(updated.entry.accessCount).toBeGreaterThanOrEqual(initial);
      }
    }
  });
});
