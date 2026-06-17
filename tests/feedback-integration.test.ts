/**
 * Real Qdrant integration tests for feedback.ts.
 *
 * Tests that applyFeedback and memoryFeedback actually update Qdrant
 * payloads via set_payload API — no mocks, real Qdrant at localhost:6333.
 *
 * TDD cycle:
 *   1. Write the test (RED — expectations express desired behaviour)
 *   2. Run to verify test harness works against real Qdrant
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
} from "./helpers/qdrant.js";
import {
  applyFeedback,
  memoryFeedback,
  computeFeedback,
} from "../src/cognitive/feedback.js";
import type { MemCell, MemCellSearchResult } from "../src/core/types.js";

const QDRANT = QDRANT_URL;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal MemCell factory — matches what Qdrant payloadToMemCell would produce. */
function makeCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    id: randomUUID(),
    text: "test memory about async database queries",
    memoryType: "semantic",
    classification: "public",
    agentId: "test-agent",
    scope: "public",
    urgency: "reference",
    domain: "technical",
    confidence: 0.7,
    confidenceTag: "grounded",
    priorityScore: 0.5,
    importance: 0.6,
    linkedMemories: [],
    accessTimes: [Date.now()],
    accessCount: 1,
    eventTime: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false,
    metadata: {},
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe("feedback integration (real Qdrant)", () => {
  const collection = testCollection("feedback_integration");

  beforeAll(async () => {
    await createTestCollection(collection);
  });

  afterAll(async () => {
    await deleteTestCollection(collection);
  });

  // ── applyFeedback ──────────────────────────────────────────────────────

  describe("applyFeedback", () => {
    it("updates importance and confidence on positive signal", async () => {
      const memId = randomUUID();
      await insertTestPoint(collection, memId, "database uses connection pooling", {
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 1, useful_count: 0 },
      });

      const mem = makeCell({
        id: memId,
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 1, useful_count: 0 },
      });
      const feedback = computeFeedback(mem, "positive");

      const applied = await applyFeedback(QDRANT, collection, memId, feedback, {
        hit_count: 1,
        useful_count: 0,
      });
      expect(applied).toBe(true);

      // Scroll to verify Qdrant payload was actually updated
      const points = await scrollCollection(collection, 100);
      const updated = points.find((p) => p.id === memId);
      expect(updated).toBeDefined();

      // Importance increased by 0.1; confidence unchanged (positive signal)
      expect(updated!.payload.importance).toBeCloseTo(0.6);
      expect(updated!.payload.confidence).toBe(0.7);

      const meta = updated!.payload.metadata as Record<string, unknown>;
      expect(meta.hit_count).toBe(2);
      expect(meta.useful_count).toBe(1);
      expect(meta.usefulness_ratio).toBeCloseTo(0.5); // 1/2
      expect(meta.needs_review).toBe(false);
      expect(meta.last_feedback).toBe("positive");
      expect(meta.last_feedback_at).toEqual(expect.any(String));
    });

    it("decreases confidence on negative signal and flags for review", async () => {
      const memId = randomUUID();
      await insertTestPoint(collection, memId, "incorrect config on port 8080", {
        importance: 0.6,
        confidence: 0.8,
        metadata: { hit_count: 3, useful_count: 2 },
      });

      const mem = makeCell({
        id: memId,
        importance: 0.6,
        confidence: 0.8,
        metadata: { hit_count: 3, useful_count: 2 },
      });
      const feedback = computeFeedback(mem, "negative");

      const applied = await applyFeedback(QDRANT, collection, memId, feedback, {
        hit_count: 3,
        useful_count: 2,
      });
      expect(applied).toBe(true);

      const points = await scrollCollection(collection, 100);
      const updated = points.find((p) => p.id === memId);
      expect(updated).toBeDefined();

      // Importance unchanged; confidence decreased by 0.1
      expect(updated!.payload.importance).toBe(0.6);
      expect(updated!.payload.confidence).toBeCloseTo(0.7);

      const meta = updated!.payload.metadata as Record<string, unknown>;
      expect(meta.hit_count).toBe(4);
      expect(meta.useful_count).toBe(2); // not incremented on negative
      expect(meta.usefulness_ratio).toBeCloseTo(0.5); // 2/4
      expect(meta.needs_review).toBe(true);
      expect(meta.last_feedback).toBe("negative");
    });

    it("promotes memory to core when usefulness is high", async () => {
      const memId = randomUUID();
      await insertTestPoint(collection, memId, "Kubernetes needs persistent volumes for stateful workloads", {
        memory_type: "semantic",
        importance: 0.5,
        confidence: 0.8,
        metadata: { hit_count: 2, useful_count: 2 },
      });

      const mem = makeCell({
        id: memId,
        importance: 0.5,
        confidence: 0.8,
        metadata: { hit_count: 2, useful_count: 2 },
      });
      const feedback = computeFeedback(mem, "positive");
      expect(feedback.promoted).toBe(true);

      const applied = await applyFeedback(QDRANT, collection, memId, feedback, {
        hit_count: 2,
        useful_count: 2,
      });
      expect(applied).toBe(true);

      const points = await scrollCollection(collection, 100);
      const updated = points.find((p) => p.id === memId);
      expect(updated).toBeDefined();

      // memory_type was promoted to core
      expect(updated!.payload.memory_type).toBe("core");

      const meta = updated!.payload.metadata as Record<string, unknown>;
      expect(meta.promoted_by).toBe("memory_feedback");
      expect(meta.promoted_at).toEqual(expect.any(String));
    });

    it("handles non-existent point gracefully (Qdrant accepts payload silently)", async () => {
      const ghostId = randomUUID();
      const mem = makeCell({ id: ghostId, importance: 0.5 });
      const feedback = computeFeedback(mem, "positive");

      const applied = await applyFeedback(QDRANT, collection, ghostId, feedback, {});
      // Qdrant set_payload returns 200 even for non-existent points
      // (it stores the payload without a vector/point body)
      expect(applied).toBe(true);
    });
  });

  // ── memoryFeedback ─────────────────────────────────────────────────────

  describe("memoryFeedback", () => {
    it("processes positive signal for multiple recalled memories", async () => {
      const memId1 = randomUUID();
      const memId2 = randomUUID();

      await insertTestPoint(collection, memId1, "database uses connection pooling for performance", {
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 1, useful_count: 0 },
      });
      await insertTestPoint(collection, memId2, "kubernetes clusters need resource limits to avoid OOM", {
        importance: 0.4,
        confidence: 0.6,
        metadata: { hit_count: 1, useful_count: 0 },
      });

      const mem1 = makeCell({
        id: memId1,
        text: "database uses connection pooling for performance",
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 1, useful_count: 0 },
      });
      const mem2 = makeCell({
        id: memId2,
        text: "kubernetes clusters need resource limits to avoid OOM",
        importance: 0.4,
        confidence: 0.6,
        metadata: { hit_count: 1, useful_count: 0 },
      });

      const recalled: MemCellSearchResult[] = [
        { entry: mem1, score: 0.95, source: "qdrant" },
        { entry: mem2, score: 0.90, source: "qdrant" },
      ];

      const results = await memoryFeedback(
        QDRANT,
        collection,
        recalled,
        "That's correct, exactly what I needed!",
      );

      // Both memories should have been processed
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.signal).toBe("positive");
        expect(r.importanceDelta).toBe(0.1);
        expect(r.confidenceDelta).toBe(0);
        expect(r.flaggedForReview).toBe(false);
      }

      // Verify Qdrant payloads were updated
      const points = await scrollCollection(collection, 100);
      const p1 = points.find((p) => p.id === memId1);
      const p2 = points.find((p) => p.id === memId2);
      expect(p1).toBeDefined();
      expect(p2).toBeDefined();

      // Both importance increased
      expect(p1!.payload.importance).toBeCloseTo(0.6);
      expect(p2!.payload.importance).toBeCloseTo(0.5);

      // Confidence unchanged by positive signal
      expect(p1!.payload.confidence).toBe(0.7);
      expect(p2!.payload.confidence).toBe(0.6);

      const m1 = p1!.payload.metadata as Record<string, unknown>;
      const m2 = p2!.payload.metadata as Record<string, unknown>;
      expect(m1.last_feedback).toBe("positive");
      expect(m2.last_feedback).toBe("positive");
      // hit_count should have been incremented (existing 1 + 1 = 2)
      expect(m1.hit_count).toBe(2);
      expect(m2.hit_count).toBe(2);
      // useful_count incremented on positive
      expect(m1.useful_count).toBe(1);
      expect(m2.useful_count).toBe(1);
    });

    it("processes negative signal for a single recalled memory", async () => {
      const memId = randomUUID();
      await insertTestPoint(collection, memId, "the old config uses port 8080 for the web service", {
        importance: 0.6,
        confidence: 0.7,
        metadata: { hit_count: 2, useful_count: 1 },
      });

      const mem = makeCell({
        id: memId,
        text: "the old config uses port 8080 for the web service",
        importance: 0.6,
        confidence: 0.7,
        metadata: { hit_count: 2, useful_count: 1 },
      });

      const recalled: MemCellSearchResult[] = [
        { entry: mem, score: 0.92, source: "qdrant" },
      ];

      const results = await memoryFeedback(
        QDRANT,
        collection,
        recalled,
        "No, that's wrong — the port changed to 9090",
      );

      expect(results.length).toBe(1);
      expect(results[0].signal).toBe("negative");
      expect(results[0].confidenceDelta).toBe(-0.1);
      expect(results[0].importanceDelta).toBe(0);
      expect(results[0].flaggedForReview).toBe(true);

      // Verify Qdrant payload updated
      const points = await scrollCollection(collection, 100);
      const updated = points.find((p) => p.id === memId);
      expect(updated).toBeDefined();

      expect(updated!.payload.confidence).toBeCloseTo(0.6); // 0.7 - 0.1
      expect(updated!.payload.importance).toBe(0.6); // unchanged

      const meta = updated!.payload.metadata as Record<string, unknown>;
      expect(meta.needs_review).toBe(true);
      expect(meta.last_feedback).toBe("negative");
      expect(meta.hit_count).toBe(3); // 2 + 1
      expect(meta.useful_count).toBe(1); // not incremented on negative
    });

    it("handles neutral signal without modifying importance or confidence", async () => {
      const memId = randomUUID();
      await insertTestPoint(collection, memId, "the sky appears blue due to Rayleigh scattering", {
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 5, useful_count: 3 },
      });

      const mem = makeCell({
        id: memId,
        text: "the sky appears blue due to Rayleigh scattering",
        importance: 0.5,
        confidence: 0.7,
        metadata: { hit_count: 5, useful_count: 3 },
      });

      const recalled: MemCellSearchResult[] = [
        { entry: mem, score: 0.85, source: "qdrant" },
      ];

      const results = await memoryFeedback(
        QDRANT,
        collection,
        recalled,
        "Tell me more about that",
      );

      // Neutral signal — no feedback results (memoryFeedback skips applyFeedback for neutral
      // unless the memory was referenced)
      expect(results.length).toBe(0);

      // Verify Qdrant payload was NOT changed (importance/confidence untouched)
      const points = await scrollCollection(collection, 100);
      const updated = points.find((p) => p.id === memId);
      expect(updated).toBeDefined();

      expect(updated!.payload.importance).toBe(0.5);
      expect(updated!.payload.confidence).toBe(0.7);

      const meta = updated!.payload.metadata as Record<string, unknown>;
      // On neutral with unreferenced memory, memoryFeedback skips entirely
      // so metadata should remain unchanged
      expect(meta.hit_count).toBe(5);
      expect(meta.useful_count).toBe(3);
    });
  });
});
