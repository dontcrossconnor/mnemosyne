/**
 * Real Qdrant integration tests for dream.ts (overnight consolidation).
 * TDD: Tests dreamDedup, dreamMerge, dreamPrune, dreamStrengthen, shouldRunDream
 * against a real Qdrant instance.
 *
 * Each describe block uses its OWN collection to avoid cross-test vector
 * contamination from leftover points.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  QDRANT_URL,
  testCollection,
  createTestCollection,
  deleteTestCollection,
} from "./helpers/qdrant.js";
import {
  dreamDedup,
  dreamMerge,
  dreamPrune,
  dreamStrengthen,
  shouldRunDream,
  type DreamConfig,
} from "../src/cognitive/dream.js";

// ============================================================================
// Helpers
// ============================================================================

const VECTOR_SIZE = 1024;

/**
 * Build a normalised vector with a known cosine similarity to a "base" vector.
 * The base vector is [1,0,0,...] in a sub-space defined by `dimOffset`.
 * Using different dimOffsets per test prevents cross-test collisions.
 */
function makeVec(
  dimOffset: number,
  targetSim: number = 1.0,
): number[] {
  const v = new Array(VECTOR_SIZE).fill(0);
  v[dimOffset] = targetSim;
  v[dimOffset + 1] = Math.sqrt(Math.max(0, 1 - targetSim * targetSim));
  return v;
}

const DEFAULT_CONFIG: DreamConfig = {
  dedupThreshold: 0.88,
  staleThresholdDays: 60,
  minImportanceToKeep: 0.2,
  maxRunTimeMs: 300_000,
  batchSize: 200,
};

/** Insert a point returning its id */
async function insertPoint(
  collection: string,
  overrides: Partial<Record<string, unknown>> & { vector?: number[] },
): Promise<string> {
  const id = randomUUID();
  // Default to dimOffset=0, sim=1.0
  const vector = overrides.vector || makeVec(0, 1.0);
  const payload: Record<string, unknown> = {
    text: `test memory ${id.slice(0, 8)}`,
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
  // Don't pass vector inside payload
  delete payload.vector;

  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wait: true, points: [{ id, vector, payload }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to insert point ${id}: ${res.status} ${body}`);
  }
  return id;
}

/** Scroll all points (including deleted) for verification */
async function scrollAll(
  collection: string,
): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1000, with_payload: true, with_vector: false }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    result: { points: Array<{ id: string; payload: Record<string, unknown> }> };
  };
  return data.result.points || [];
}

/** Get a single point's payload by id */
async function getPoint(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const points = await scrollAll(collection);
  return points.find(p => p.id === id)?.payload ?? null;
}

/**
 * Create + delete wrapper to keep each describe block isolated.
 */
function useCollection() {
  const coll = testCollection("dream");
  beforeAll(async () => {
    await createTestCollection(coll);
  });
  afterAll(async () => {
    await deleteTestCollection(coll);
  });
  return coll;
}

// ============================================================================
// Tests
// ============================================================================

describe("dreamDedup", () => {
  const coll = useCollection();
  // Use dimOffset 0-9 for this block
  const DIM = 0;

  it("merges pairs with similarity > 0.88, keeps higher access_count", async () => {
    // Pair A-B: sim = 0.95 (> 0.88)
    // A has access_count=10 (keeper), B has access_count=1 (loser)
    const idA = await insertPoint(coll, {
      access_count: 10,
      access_times: [Date.now()],
      importance: 0.7,
      vector: makeVec(DIM, 1.0),
    });
    const idB = await insertPoint(coll, {
      access_count: 1,
      access_times: [Date.now() - 3600_000],
      importance: 0.7,
      vector: makeVec(DIM, 0.95),
    });

    // Pair C-D: sim = 0.50 (< 0.88) — should NOT merge
    // Use a dim offset so C-D don't collide with A-B
    const idC = await insertPoint(coll, {
      access_count: 5,
      vector: makeVec(DIM + 2, 1.0),
    });
    const idD = await insertPoint(coll, {
      access_count: 5,
      vector: makeVec(DIM + 2, 0.50),
    });

    const result = await dreamDedup(QDRANT_URL, coll, DEFAULT_CONFIG);

    expect(result.merged).toBeGreaterThanOrEqual(1);

    // Verify keeper (A) kept merged access_count
    const payloadA = await getPoint(coll, idA);
    expect(payloadA).not.toBeNull();
    expect(payloadA!.access_count).toBe(11); // 10 + 1

    // Verify loser (B) was soft-deleted
    const payloadB = await getPoint(coll, idB);
    expect(payloadB).not.toBeNull();
    expect(payloadB!.deleted).toBe(true);
    const metaB = (payloadB!.metadata as Record<string, unknown>) || {};
    expect(metaB.dream_merged_into).toBe(idA);

    // Verify C and D are still active (sim 0.50 < 0.88)
    const payloadC = await getPoint(coll, idC);
    expect(payloadC!.deleted).toBe(false);
    const payloadD = await getPoint(coll, idD);
    expect(payloadD!.deleted).toBe(false);
  });

  it("keeps the point with higher access_count as keeper", async () => {
    // A: access_count=1 (should be loser), B: access_count=10 (should be keeper)
    // Use a fresh dim so these don't interfere with previous test's leftovers
    const idA = await insertPoint(coll, {
      access_count: 1,
      importance: 0.7,
      vector: makeVec(DIM + 4, 1.0),
    });
    const idB = await insertPoint(coll, {
      access_count: 10,
      importance: 0.7,
      vector: makeVec(DIM + 4, 0.95),
    });

    const result = await dreamDedup(QDRANT_URL, coll, DEFAULT_CONFIG);

    expect(result.merged).toBeGreaterThanOrEqual(1);

    // B (higher count) should be the keeper, unchanged / elevated
    const payloadB = await getPoint(coll, idB);
    expect(payloadB).not.toBeNull();
    expect(payloadB!.deleted).toBe(false);
    expect(payloadB!.access_count).toBe(11);

    // A (lower count) should be the loser, soft-deleted
    const payloadA = await getPoint(coll, idA);
    expect(payloadA!.deleted).toBe(true);
  });
});

describe("dreamMerge", () => {
  const coll = useCollection();
  const DIM = 10;

  it("groups similar episodic memories into semantic", async () => {
    // Three similar episodic memories (sim > 0.80 with each other)
    // A: access_count=10 (keeper)
    const idA = await insertPoint(coll, {
      memory_type: "episodic",
      access_count: 10,
      access_times: [Date.now()],
      linked_memories: ["link1"],
      importance: 0.7,
      vector: makeVec(DIM, 1.0),
    });
    // B: sim 0.90 with A
    const idB = await insertPoint(coll, {
      memory_type: "episodic",
      access_count: 5,
      access_times: [Date.now() - 3600_000],
      linked_memories: ["link2"],
      importance: 0.6,
      vector: makeVec(DIM, 0.90),
    });
    // C: sim 0.85 with A (still > 0.80)
    const idC = await insertPoint(coll, {
      memory_type: "episodic",
      access_count: 1,
      access_times: [Date.now() - 7200_000],
      linked_memories: ["link3"],
      importance: 0.5,
      vector: makeVec(DIM, 0.85),
    });

    // A semantic memory with similar vector but different type — should NOT be grouped
    const idSemantic = await insertPoint(coll, {
      memory_type: "semantic",
      access_count: 3,
      vector: makeVec(DIM, 0.90),
    });

    const result = await dreamMerge(QDRANT_URL, coll, DEFAULT_CONFIG);

    expect(result.merged).toBeGreaterThanOrEqual(2);

    // A (keeper) should now be promoted to semantic with merged counts
    const payloadA = await getPoint(coll, idA);
    expect(payloadA).not.toBeNull();
    expect(payloadA!.memory_type).toBe("semantic");
    expect(payloadA!.access_count).toBe(16); // 10 + 5 + 1
    const metaA = (payloadA!.metadata as Record<string, unknown>) || {};
    expect(metaA.dream_promoted_from).toBe("episodic");

    // B and C should be soft-deleted
    const payloadB = await getPoint(coll, idB);
    expect(payloadB!.deleted).toBe(true);
    const payloadC = await getPoint(coll, idC);
    expect(payloadC!.deleted).toBe(true);

    // Semantic point should remain unchanged (not merged into the episodic group)
    const payloadSem = await getPoint(coll, idSemantic);
    expect(payloadSem!.deleted).toBe(false);
  });
});

describe("dreamPrune", () => {
  const coll = useCollection();
  const DIM = 20;

  it("archives memories with activation < -4.0 and low importance", async () => {
    // Memory with very old access_time (100 days ago), low importance, semantic type
    // → activation will be well below -4.0
    const hundredDaysAgo = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const idOldLow = await insertPoint(coll, {
      memory_type: "semantic",
      importance: 0.1,
      access_times: [hundredDaysAgo],
      urgency: "background",
      vector: makeVec(DIM, 1.0),
    });

    // Core memory — should NOT be pruned (protected type)
    const idCore = await insertPoint(coll, {
      memory_type: "core",
      importance: 0.1,
      access_times: [hundredDaysAgo],
      vector: makeVec(DIM + 2, 1.0),
    });

    // Procedural memory — should NOT be pruned (protected type)
    const idProcedural = await insertPoint(coll, {
      memory_type: "procedural",
      importance: 0.1,
      access_times: [hundredDaysAgo],
      vector: makeVec(DIM + 4, 1.0),
    });

    // High-importance memory — should NOT be pruned despite old accesses
    const idHighImp = await insertPoint(coll, {
      memory_type: "semantic",
      importance: 0.8,
      access_times: [hundredDaysAgo],
      vector: makeVec(DIM + 6, 1.0),
    });

    const result = await dreamPrune(QDRANT_URL, coll, DEFAULT_CONFIG);

    expect(result.archived).toBeGreaterThanOrEqual(1);

    // Old low-importance memory should be archived
    const pOld = await getPoint(coll, idOldLow);
    expect(pOld!.deleted).toBe(true);
    const metaOld = (pOld!.metadata as Record<string, unknown>) || {};
    expect(metaOld.dream_archived).toBe(true);

    // Protected types unchanged
    const pCore = await getPoint(coll, idCore);
    expect(pCore!.deleted).toBe(false);
    const pProc = await getPoint(coll, idProcedural);
    expect(pProc!.deleted).toBe(false);
    const pHigh = await getPoint(coll, idHighImp);
    expect(pHigh!.deleted).toBe(false);
  });
});

describe("dreamStrengthen", () => {
  const coll = useCollection();
  const DIM = 30;

  it("boosts importance for access_count > 5, confidence for usefulness_ratio > 0.5", async () => {
    // A: access_count=10, importance=0.5 → importance should become 0.6
    const idA = await insertPoint(coll, {
      access_count: 10,
      importance: 0.5,
      confidence: 0.7,
      vector: makeVec(DIM, 1.0),
    });

    // B: access_count=10, importance=0.95 → capped at 1.0
    const idB = await insertPoint(coll, {
      access_count: 10,
      importance: 0.95,
      confidence: 0.7,
      vector: makeVec(DIM + 2, 1.0),
    });

    // C: access_count=3 → should NOT be strengthened (not > 5)
    const idC = await insertPoint(coll, {
      access_count: 3,
      importance: 0.5,
      confidence: 0.7,
      vector: makeVec(DIM + 4, 1.0),
    });

    // D: access_count=10, usefulness_ratio=0.6 → confidence should boost
    const idD = await insertPoint(coll, {
      access_count: 10,
      importance: 0.5,
      confidence: 0.7,
      metadata: { usefulness_ratio: 0.6 },
      vector: makeVec(DIM + 6, 1.0),
    });

    // E: confidence=0.98, usefulness_ratio=0.6 → capped at 1.0
    const idE = await insertPoint(coll, {
      access_count: 10,
      importance: 0.5,
      confidence: 0.98,
      metadata: { usefulness_ratio: 0.6 },
      vector: makeVec(DIM + 8, 1.0),
    });

    const result = await dreamStrengthen(QDRANT_URL, coll, DEFAULT_CONFIG);

    expect(result.strengthened).toBeGreaterThanOrEqual(1);

    // A: importance 0.5 → 0.6
    const pA = await getPoint(coll, idA);
    expect(pA!.importance).toBe(0.6);

    // B: importance 0.95 → 1.0 (capped)
    const pB = await getPoint(coll, idB);
    expect(pB!.importance).toBe(1.0);

    // C: unchanged (access_count=3, not > 5)
    const pC = await getPoint(coll, idC);
    expect(pC!.importance).toBe(0.5);

    // D: importance 0.5 → 0.6, confidence 0.7 → 0.75
    const pD = await getPoint(coll, idD);
    expect(pD!.importance).toBe(0.6);
    expect(pD!.confidence).toBe(0.75);

    // E: confidence 0.98 → 1.0 (capped)
    const pE = await getPoint(coll, idE);
    expect(pE!.confidence).toBe(1.0);
  });
});

describe("shouldRunDream", () => {
  // We need the private collection for shouldRunDream queries
  const privateColl = "memory_private";

  beforeAll(async () => {
    // Ensure the private collection exists
    try {
      const res = await fetch(`${QDRANT_URL}/collections/${privateColl}`);
      if (!res.ok) {
        await createTestCollection(privateColl);
      }
    } catch {
      await createTestCollection(privateColl);
    }
  });

  it("returns true when dream has never run for this agent", async () => {
    // Use a truly unique agent id that cannot have a dream meta record
    const freshAgentId = `test-never-run-${randomUUID().slice(0, 8)}`;
    const result = await shouldRunDream(QDRANT_URL, freshAgentId);
    expect(result).toBe(true);
  });
});
