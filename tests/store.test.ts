/**
 * Store tool integration tests — real Qdrant + Ollama, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QdrantDB } from "../src/core/qdrant.js";
import { EmbeddingsClient } from "../src/core/embeddings.js";
import { store } from "../src/tools/store.js";
import { BM25Index } from "../src/core/bm25.js";
import { testCollection, createTestCollection, deleteTestCollection } from "./helpers/qdrant.js";

const QDRANT_URL = "http://localhost:6333";
const OLLAMA_URL = "http://localhost:11434/v1/embeddings";
const AGENT_ID = "test-agent";

describe("store (real Qdrant + Ollama)", () => {
  const sharedColl = testCollection("store");
  const privateColl = testCollection("store_priv");
  const collections = { shared: sharedColl, private: privateColl };
  let db: QdrantDB;
  let embeddings: EmbeddingsClient;

  beforeAll(async () => {
    await createTestCollection(sharedColl);
    await createTestCollection(privateColl);
    db = new QdrantDB(QDRANT_URL, AGENT_ID, collections);
    embeddings = new EmbeddingsClient(OLLAMA_URL, "mxbai-embed-large");
  });

  afterAll(async () => {
    await deleteTestCollection(sharedColl);
    await deleteTestCollection(privateColl);
  });

  const ctx = () => ({ db, embeddings, agentId: AGENT_ID as string, collections });

  it("stores a simple text memory and returns a cell with ID", async () => {
    const cell = await store(ctx(), "the server IP is 192.168.1.1");
    expect(cell).toBeDefined();
    expect(cell.id).toBeTruthy();
  });

  it("stores to Qdrant — point is searchable", async () => {
    const text = "memory with embedding test";
    const cell = await store(ctx(), text);
    const vector = await embeddings.embed(text);
    const res = await fetch(`${QDRANT_URL}/collections/${sharedColl}/points/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vector,
        limit: 1,
        filter: { must: [{ key: "deleted", match: { value: false } }] },
        with_payload: true,
      }),
    });
    const data = await res.json() as { result: Array<unknown> };
    expect(data.result.length).toBeGreaterThan(0);
  });

  it("rejects SECRET-classified content", async () => {
    await expect(
      store(ctx(), "my password is hunter2", { classification: "secret" }),
    ).rejects.toThrow("Cannot store SECRET-classified content");
  });

  it("classifies memory type automatically", async () => {
    expect((await store(ctx(), "Step 1: install Docker")).memoryType).toBe("procedural");
  });

  it("classifies urgency automatically", async () => {
    expect((await store(ctx(), "URGENT: the server is down")).urgency).toBe("critical");
  });

  it("classifies domain automatically", async () => {
    expect((await store(ctx(), "Deploy the Docker container")).domain).toBe("technical");
  });

  it("respects explicit memoryType override", async () => {
    expect((await store(ctx(), "some text", { memoryType: "core" })).memoryType).toBe("core");
  });

  it("uses default importance of 0.7", async () => {
    expect((await store(ctx(), "default importance test")).importance).toBe(0.7);
  });

  it("respects explicit importance", async () => {
    expect((await store(ctx(), "high importance fact", { importance: 0.95 })).importance).toBe(0.95);
  });

  it("updates BM25 index when provided", async () => {
    const bm25 = new BM25Index();
    const cell = await store({ ...ctx(), bm25Index: bm25 }, "indexed document content");
    expect(bm25.search("indexed document", 10).length).toBe(1);
  });

  it("fires broadcast callback when provided", async () => {
    let called = false;
    await store({ ...ctx(), onBroadcast: () => { called = true; } }, "broadcast test");
    expect(called).toBe(true);
  });

  it("stores private in private collection", async () => {
    const cell = await store(ctx(), "private data", { classification: "private" });
    const point = await db.getPoint(privateColl, cell.id);
    expect(point).not.toBeNull();
  });

  it("passes metadata to stored point", async () => {
    const cell = await store(ctx(), "meta test", { metadata: { source: "test" } });
    const point = await db.getPoint(sharedColl, cell.id);
    expect(point?.metadata).toBeDefined();
  });
});
