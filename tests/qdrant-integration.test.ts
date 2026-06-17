/**
 * Smoke test — verifies real Qdrant integration helper works.
 * TDD: This test will fail if Qdrant isn't running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  QDRANT_URL,
  testCollection,
  createTestCollection,
  deleteTestCollection,
  insertTestPoint,
  searchCollection,
  scrollCollection,
  textToVector,
} from "./helpers/qdrant.js";

describe("Qdrant integration (real)", () => {
  const collection = testCollection("smoke");
  const vector = textToVector("test memory about servers");

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  it("creates a collection", async () => {
    const res = await fetch(`${QDRANT_URL}/collections/${collection}`);
    expect(res.ok).toBe(true);
  });

  it("inserts and retrieves a point", async () => {
    const id = randomUUID();
    await insertTestPoint(collection, id, "the server IP is 192.168.1.1");

    const results = await searchCollection(collection, vector, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.id === id)).toBe(true);
  });

  it("searches with similarity ranking", async () => {
    const deployText = "deploy the docker container to kubernetes";
    const id1 = await insertTestPoint(collection, undefined, "user prefers dark mode for the editor");
    const id2 = await insertTestPoint(collection, undefined, deployText);

    // Query with text that matches the deploy point exactly
    const queryVec = textToVector(deployText);
    const results = await searchCollection(collection, queryVec, 5);
    expect(results.length).toBeGreaterThan(0);

    // The deploy point should rank #1 (identical vector match)
    expect(results[0].id).toBe(id2);
  });

  it("scrolls all points", async () => {
    const points = await scrollCollection(collection, 100);
    expect(points.length).toBeGreaterThanOrEqual(3);
  });

  it("filters by payload field", async () => {
    await insertTestPoint(collection, undefined, "filterable memory", {
      memory_type: "procedural",
    });

    const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vector,
        limit: 10,
        filter: {
          must: [
            { key: "deleted", match: { value: false } },
            { key: "memory_type", match: { value: "procedural" } },
          ],
        },
        with_payload: true,
      }),
    });
    const data = await res.json() as { result: Array<unknown> };
    expect(data.result.length).toBeGreaterThan(0);
  });

  it("handles empty collection search gracefully", async () => {
    const emptyColl = testCollection("empty");
    await createTestCollection(emptyColl);

    const results = await searchCollection(emptyColl, vector, 10);
    expect(results).toEqual([]);

    await deleteTestCollection(emptyColl);
  });
});
