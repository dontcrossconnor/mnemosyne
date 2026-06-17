/**
 * Real Redis integration tests for the LayerCache (L1/L2 cache).
 *
 * Prerequisites:
 *   - Redis running on redis://localhost:6379
 *   - ioredis installed (devDependency)
 *
 * Tests two modes:
 *   (1) Without Redis connection — only L1 in-memory cache is exercised.
 *   (2) With real Redis connection — exercises L2 promotion, full invalidation,
 *       and cross-tier cache behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { LayerCache } from "../src/cache/layer-cache.js";
import type { MemCellSearchResult } from "../src/core/types.js";

// ===========================================================================
// Helpers
// ===========================================================================

const REDIS_URL = "redis://localhost:6379";
const BAD_REDIS_URL = "redis://localhost:16379";

function makeResult(text: string, score: number): MemCellSearchResult {
  return {
    entry: {
      id: randomUUID(),
      text,
      memoryType: "semantic",
      classification: "public",
      agentId: "test",
      scope: "public",
      urgency: "reference",
      domain: "knowledge",
      confidence: 1.0,
      confidenceTag: "verified",
      priorityScore: 0.5,
      importance: 0.5,
      linkedMemories: [],
      accessTimes: [Date.now()],
      accessCount: 1,
      eventTime: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
    },
    score,
  };
}

// ===========================================================================
// Suite
// ===========================================================================

describe("LayerCache integration (real Redis)", () => {
  // -----------------------------------------------------------------------
  // Without Redis — L1 in-memory cache only
  // -----------------------------------------------------------------------
  describe("without Redis (no connection)", () => {
    let cache: LayerCache;

    beforeAll(() => {
      // Pass a bad URL so L2 never connects; L1 works standalone.
      cache = new LayerCache(BAD_REDIS_URL);
    });

    it("stores and retrieves from L1 via set/get", async () => {
      const results = [makeResult("test memory", 0.95)];
      await cache.set("hello world", 10, 0.5, results);

      const got = await cache.get("hello world", 10, 0.5);
      expect(got).not.toBeNull();
      expect(got).toHaveLength(1);
      expect(got![0].entry.text).toBe("test memory");
      expect(got![0].score).toBe(0.95);
    });

    it("returns null for cache miss", async () => {
      const got = await cache.get("nonexistent query", 5, 0.0);
      expect(got).toBeNull();
    });

    it("invalidates all clears L1 cache", async () => {
      const results = [makeResult("something", 0.8)];
      await cache.set("key1", 10, 0.5, results);
      await cache.set("key2", 5, 0.3, results);

      await cache.invalidateAll();

      const got1 = await cache.get("key1", 10, 0.5);
      const got2 = await cache.get("key2", 5, 0.3);
      expect(got1).toBeNull();
      expect(got2).toBeNull();
      expect(cache.l1.size).toBe(0);
    });

    it("cache key normalization ignores case and trims", async () => {
      const results = [makeResult("case test", 1.0)];
      await cache.set("  Hello World  ", 5, 0.0, results);

      const got = await cache.get("HELLO WORLD", 5, 0.0);
      expect(got).not.toBeNull();
      expect(got![0].entry.text).toBe("case test");
    });

    it("l1.size tracks entry count", async () => {
      // Clear any leftovers from sibling tests
      cache.l1.invalidate();
      expect(cache.l1.size).toBe(0);

      const results = [makeResult("size check", 0.5)];

      await cache.set("a", 1, 0, results);
      expect(cache.l1.size).toBe(1);

      await cache.set("b", 1, 0, results);
      expect(cache.l1.size).toBe(2);

      await cache.invalidateAll();
      expect(cache.l1.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // With real Redis — L2 + L1/L2 interaction
  // -----------------------------------------------------------------------
  describe("with real Redis connection", () => {
    let cache: LayerCache;

    beforeAll(async () => {
      // Pre-clean any leftover cache keys from previous runs
      const cleaner = new LayerCache(REDIS_URL);
      await cleaner.connect();
      await cleaner.invalidateAll();
      await cleaner.disconnect();

      // Fresh cache for the suite
      cache = new LayerCache(REDIS_URL);
      await cache.connect();
    });

    afterAll(async () => {
      await cache.invalidateAll().catch(() => {});
      await cache.disconnect().catch(() => {});
    });

    it("connect succeeds and L2 is available", () => {
      expect(cache.l2.isAvailable).toBe(true);
    });

    it("stores and retrieves from L2 (cross-tier)", async () => {
      const results = [makeResult("redis stored memory", 0.99)];
      await cache.set("redis test", 10, 0.5, results);

      const got = await cache.get("redis test", 10, 0.5);
      expect(got).not.toBeNull();
      expect(got).toHaveLength(1);
      expect(got![0].entry.text).toBe("redis stored memory");
    });

    it("L1 serves cached data after L2 lookup (promotion)", async () => {
      const results = [makeResult("promotion test", 0.88)];
      const query = "promotion check";
      await cache.set(query, 3, 0.2, results);

      // First get populates L1 from L2 (set writes to both tiers,
      // but after L2-only invalidation, L1 should still serve it)
      const first = await cache.get(query, 3, 0.2);
      expect(first).not.toBeNull();

      // Manually clear L2 only
      await cache.l2.invalidate(query);

      // L1 should still serve the result (promoted from the earlier get->set)
      const second = await cache.get(query, 3, 0.2);
      expect(second).not.toBeNull();
      expect(second![0].entry.text).toBe("promotion test");
    });

    it("invalidateAll clears both L1 and L2", async () => {
      const results = [makeResult("clear me", 0.75)];
      await cache.set("invalidate target", 5, 0.4, results);

      // Verify present
      const before = await cache.get("invalidate target", 5, 0.4);
      expect(before).not.toBeNull();

      // Full invalidation
      await cache.invalidateAll();

      // L1 size is 0
      expect(cache.l1.size).toBe(0);

      // Cache miss across both tiers
      const after = await cache.get("invalidate target", 5, 0.4);
      expect(after).toBeNull();
    });

    it("handles multiple entries with different query params", async () => {
      const r1 = [makeResult("query with limit 5", 0.9)];
      const r2 = [makeResult("query with limit 20", 0.8)];

      await cache.set("multi", 5, 0.5, r1);
      await cache.set("multi", 20, 0.5, r2);

      // Different limit = different cache key
      const got1 = await cache.get("multi", 5, 0.5);
      const got2 = await cache.get("multi", 20, 0.5);

      expect(got1).not.toBeNull();
      expect(got1![0].entry.text).toBe("query with limit 5");

      expect(got2).not.toBeNull();
      expect(got2![0].entry.text).toBe("query with limit 20");
    });
  });
});
