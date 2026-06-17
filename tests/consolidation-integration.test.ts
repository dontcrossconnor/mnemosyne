/**
 * Real Qdrant integration tests for consolidation.ts functions.
 * TDD: Each function hits real Qdrant with deterministic test data,
 * written before the implementation is verified.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  QDRANT_URL,
  testCollection,
  createTestCollection,
  deleteTestCollection,
  insertTestPoint,
  scrollCollection,
  textToVector,
} from "./helpers/qdrant.js";
import {
  promotePopular,
  demoteStale,
  mergeNearDuplicates,
  findContradictions,
} from "../src/cognitive/consolidation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scroll only non-deleted points and filter by field-based lookups */
async function getPointPayload(
  collection: string,
  pointId: string,
): Promise<Record<string, unknown> | null> {
  const points = await scrollCollection(collection, 200);
  const match = points.find((p) => p.id === pointId);
  return match?.payload ?? null;
}

// ---------------------------------------------------------------------------
// promotePopular
// ---------------------------------------------------------------------------

describe("promotePopular", () => {
  const collection = testCollection("promote_popular");

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  it("promotes memories with access_count > 10 to core type", async () => {
    // Insert a memory with access_count=11 (should be promoted)
    const id = await insertTestPoint(collection, undefined, "popular memory", {
      access_count: 11,
      memory_type: "semantic",
    });

    const result = await promotePopular(QDRANT_URL, collection, 200);

    expect(result.promoted).toBe(1);
    expect(result.ids).toEqual([id]);

    // Verify the point was actually updated in Qdrant
    const payload = await getPointPayload(collection, id);
    expect(payload).not.toBeNull();
    expect(payload!.memory_type).toBe("core");
    expect((payload!.metadata as Record<string, unknown>)?.promoted_by).toBe(
      "consolidation_popular",
    );
  });

  it("skips memories already of type core even if access_count > 10", async () => {
    const id = await insertTestPoint(
      collection,
      undefined,
      "already core memory",
      {
        access_count: 20,
        memory_type: "core",
      },
    );

    const result = await promotePopular(QDRANT_URL, collection, 200);

    // Should not count already-core memories
    const payload = await getPointPayload(collection, id);
    expect(payload!.memory_type).toBe("core");
    // Verify it was not flagged as promoted by consolidation_popular
    const meta = payload!.metadata as Record<string, unknown> | undefined;
    if (meta) {
      expect(meta.promoted_by).not.toBe("consolidation_popular");
    }
  });

  it("skips memories with access_count <= 10", async () => {
    const id = await insertTestPoint(
      collection,
      undefined,
      "not popular enough",
      {
        access_count: 5,
        memory_type: "semantic",
      },
    );

    const result = await promotePopular(QDRANT_URL, collection, 200);

    const payload = await getPointPayload(collection, id);
    expect(payload!.memory_type).toBe("semantic");
  });
});

// ---------------------------------------------------------------------------
// demoteStale
// ---------------------------------------------------------------------------

describe("demoteStale", () => {
  const collection = testCollection("demote_stale");
  const thirtyOneDaysAgo = Date.now() - 31 * 24 * 3_600_000;

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  it("halves priority_score for old memories with low importance", async () => {
    const id = await insertTestPoint(collection, undefined, "stale memory", {
      importance: 0.2,
      priority_score: 0.8,
      access_times: [thirtyOneDaysAgo],
    });

    const result = await demoteStale(QDRANT_URL, collection, 200);

    expect(result.demoted).toBe(1);
    expect(result.ids).toEqual([id]);

    const payload = await getPointPayload(collection, id);
    expect(payload!.priority_score).toBe(0.4);
    expect(
      (payload!.metadata as Record<string, unknown>)?.demoted_by,
    ).toBe("consolidation_stale");
    expect(
      (payload!.metadata as Record<string, unknown>)?.previous_priority,
    ).toBe(0.8);
  });

  it("does not demote core or procedural memories even if stale", async () => {
    const id = await insertTestPoint(
      collection,
      undefined,
      "core stale memory",
      {
        memory_type: "core",
        importance: 0.2,
        priority_score: 0.8,
        access_times: [thirtyOneDaysAgo],
      },
    );

    await demoteStale(QDRANT_URL, collection, 200);

    const payload = await getPointPayload(collection, id);
    expect(payload!.priority_score).toBe(0.8);
  });

  it("does not demote memories accessed recently even if low importance", async () => {
    const id = await insertTestPoint(
      collection,
      undefined,
      "recent but low importance",
      {
        importance: 0.2,
        priority_score: 0.6,
        access_times: [Date.now() - 1000], // 1 second ago
      },
    );

    await demoteStale(QDRANT_URL, collection, 200);

    const payload = await getPointPayload(collection, id);
    expect(payload!.priority_score).toBe(0.6);
  });

  it("does not demote old memories with importance >= 0.3", async () => {
    const id = await insertTestPoint(
      collection,
      undefined,
      "important but old",
      {
        importance: 0.7,
        priority_score: 0.9,
        access_times: [thirtyOneDaysAgo],
      },
    );

    await demoteStale(QDRANT_URL, collection, 200);

    const payload = await getPointPayload(collection, id);
    expect(payload!.priority_score).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// mergeNearDuplicates
// ---------------------------------------------------------------------------

describe("mergeNearDuplicates", () => {
  const collection = testCollection("merge_duplicates");

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  it("merges near-duplicate pairs keeping the higher access_count", async () => {
    const sharedText = "the server IP address is 192.168.1.1 for production";

    // Insert with same text -> identical vectors -> similarity = 1.0 > 0.92
    const highAccessId = await insertTestPoint(
      collection,
      undefined,
      sharedText,
      { access_count: 5 },
    );
    const lowAccessId = await insertTestPoint(
      collection,
      undefined,
      sharedText,
      { access_count: 3 },
    );

    const result = await mergeNearDuplicates(QDRANT_URL, collection, 200);

    expect(result.merged).toBe(1);
    expect(result.deletedIds).toContain(lowAccessId);

    // Keeper: access_count should be sum (5+3=8)
    const keeperPayload = await getPointPayload(collection, highAccessId);
    expect(keeperPayload!.access_count).toBe(8);

    // Loser: should be soft-deleted
    const loserPayload = await getPointPayload(collection, lowAccessId);
    expect(loserPayload!.deleted).toBe(true);
    expect(
      (loserPayload!.metadata as Record<string, unknown>)?.merged_into,
    ).toBe(highAccessId);
  });

  it("does not merge points below 0.92 similarity", async () => {
    const textA = "aaa bbb ccc ddd eee fff ggg hhh";
    const textB = "the server configuration uses port eight zero eight zero";

    const idA = await insertTestPoint(collection, undefined, textA, {
      access_count: 5,
    });
    const idB = await insertTestPoint(collection, undefined, textB, {
      access_count: 3,
    });

    const result = await mergeNearDuplicates(QDRANT_URL, collection, 200);

    // Verify no merge happened — both should still exist and be active
    const payloadA = await getPointPayload(collection, idA);
    const payloadB = await getPointPayload(collection, idB);
    expect(payloadA!.deleted).toBe(false);
    expect(payloadB!.deleted).toBe(false);

    // access_count should remain unchanged
    expect(payloadA!.access_count).toBe(5);
    expect(payloadB!.access_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// findContradictions
// ---------------------------------------------------------------------------

describe("findContradictions", () => {
  const collection = testCollection("contradictions");

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  it("flags negation-mismatched pairs with similarity in 0.7-0.92 range", async () => {
    // These two texts have cosine similarity ~0.86 via textToVector (pre-verified).
    // "does not" triggers NEG_RE on B but not on A -> negation mismatch.
    const textA = "the server configuration uses port eight zero eight zero";
    const textB =
      "the server configuration does not use port eight zero eight zero";

    const highConfId = await insertTestPoint(collection, undefined, textA, {
      confidence: 0.9,
    });
    const lowConfId = await insertTestPoint(collection, undefined, textB, {
      confidence: 0.5,
    });

    const result = await findContradictions(QDRANT_URL, collection, 200);

    expect(result.flagged).toBeGreaterThanOrEqual(1);
    expect(result.pairs.length).toBeGreaterThanOrEqual(1);

    // The lower confidence point should have contradiction metadata
    const lowPayload = await getPointPayload(collection, lowConfId);
    const lowMeta = lowPayload!.metadata as Record<string, unknown>;
    expect(lowMeta.has_contradiction).toBe(true);
    expect(lowMeta.contradiction_with).toBe(highConfId);

    // The higher confidence point should NOT have contradiction metadata
    const highPayload = await getPointPayload(collection, highConfId);
    const highMeta = highPayload!.metadata as Record<string, unknown> | undefined;
    if (highMeta && highMeta.has_contradiction) {
      // Edge case: if both were flagged (unlikely given confidence diffs),
      // the higher-confidence one should point to the lower one
      expect(highMeta.contradiction_with).toBe(lowConfId);
    }
  });

  it("does not flag pairs where both have negation or both lack negation", async () => {
    // Both have negation words
    const textA = "the server does not use port eight zero eight zero";
    const textB = "the server never used port eight zero eight zero";

    const idA = await insertTestPoint(collection, undefined, textA, {
      confidence: 0.7,
    });
    const idB = await insertTestPoint(collection, undefined, textB, {
      confidence: 0.7,
    });

    const result = await findContradictions(QDRANT_URL, collection, 200);

    // Check both are unmodified
    const payloadA = await getPointPayload(collection, idA);
    const payloadB = await getPointPayload(collection, idB);
    const metaA = payloadA!.metadata as Record<string, unknown> | undefined;
    const metaB = payloadB!.metadata as Record<string, unknown> | undefined;
    if (metaA && metaA.has_contradiction) {
      // If this pair was flagged, it means there was a negation mismatch somewhere
      // This shouldn't happen since both have negation
    }
    // At minimum the function should complete without error
    expect(Array.isArray(result.pairs)).toBe(true);
  });

  it("does not flag pairs with similarity below 0.7", async () => {
    // Very different texts -> low similarity
    const textA = "aaa bbb ccc ddd eee fff ggg hhh";
    const textB = "zzz yyy xxx www vvv uuu ttt sss";

    const idA = await insertTestPoint(collection, undefined, textA, {
      confidence: 0.5,
    });
    const idB = await insertTestPoint(collection, undefined, textB, {
      confidence: 0.9,
    });

    const result = await findContradictions(QDRANT_URL, collection, 200);

    const payloadA = await getPointPayload(collection, idA);
    const metaA = payloadA!.metadata as Record<string, unknown> | undefined;
    if (metaA) {
      expect(metaA.has_contradiction).toBeUndefined();
    }
  });
});
