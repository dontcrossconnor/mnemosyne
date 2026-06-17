import { randomUUID } from "node:crypto";

const QDRANT_URL = "http://localhost:6333";
const VECTOR_SIZE = 1024;

/** Unique collection name per test run to avoid collisions */
let collCounter = 0;
export function testCollection(name: string): string {
  collCounter++;
  const pid = process.pid || 0;
  return `test_${name}_${pid}_${collCounter}_${Date.now()}`.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

/** Create a Qdrant collection for testing */
export async function createTestCollection(collection: string): Promise<void> {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: "Cosine" } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create collection ${collection}: ${res.status} ${body}`);
  }
}

/** Delete a test collection */
export async function deleteTestCollection(collection: string): Promise<void> {
  await fetch(`${QDRANT_URL}/collections/${collection}`, { method: "DELETE" });
}

/** Insert a test point with a known vector. Returns the point UUID. */
export async function insertTestPoint(
  collection: string,
  id?: string,
  text?: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const pointId = id || randomUUID();
  const pointText = text || `test memory ${pointId.slice(0, 8)}`;
  const vector = textToVector(pointText);

  const payload: Record<string, unknown> = {
    text: pointText,
    agent_id: "test-agent",
    memory_type: "semantic",
    classification: "public",
    scope: "public",
    urgency: "reference",
    domain: "knowledge",
    confidence: 0.8,
    importance: 0.7,
    access_count: 1,
    access_times: [Date.now()],
    linked_memories: [],
    deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    event_time: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };

  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wait: true, points: [{ id: pointId, vector, payload }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to insert point ${pointId}: ${res.status} ${body}`);
  }
  return pointId;
}

/** Search a collection */
export async function searchCollection(
  collection: string,
  queryVector: number[],
  limit = 10,
): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vector: queryVector,
      limit,
      filter: { must: [{ key: "deleted", match: { value: false } }] },
      with_payload: true,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json() as { result: Array<{ id: string; score: number; payload: Record<string, unknown> }> };
  return data.result || [];
}

/** Scroll all points from a collection */
export async function scrollCollection(
  collection: string,
  limit = 100,
): Promise<Array<{ id: string; payload: Record<string, unknown>; vector?: number[] }>> {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, with_payload: true, with_vector: true }),
  });
  if (!res.ok) return [];
  const data = await res.json() as { result: { points: Array<{ id: string; payload: Record<string, unknown>; vector?: number[] }> } };
  return data.result.points || [];
}

/** Convert text to a deterministic 768-dim vector for testing */
export function textToVector(text: string): number[] {
  const vector = new Array(VECTOR_SIZE).fill(0);
  const chars = text.split("");
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    vector[i % VECTOR_SIZE] += (code % 100) / 100;
  }
  const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (mag > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= mag;
  }
  return vector;
}

export { QDRANT_URL, VECTOR_SIZE };
