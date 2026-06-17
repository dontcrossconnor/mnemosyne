import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  contentHash,
  stableNumericId,
  isDuplicate,
  detectConflict,
  shouldSemanticMerge,
  buildMergedPayload,
  type SemanticMergeResult,
} from "../src/core/dedup.js";
import type { MemCell, MemCellSearchResult } from "../src/core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    id: "cell-1",
    text: "test memory",
    memoryType: "semantic",
    classification: "public",
    agentId: "test-agent",
    scope: "public",
    urgency: "reference",
    domain: "technical",
    confidence: 0.8,
    confidenceTag: "grounded",
    priorityScore: 0.5,
    importance: 0.7,
    linkedMemories: [],
    accessTimes: [Date.now()],
    accessCount: 1,
    eventTime: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false,
    ...overrides,
  };
}

function makeSearchResult(
  overrides: Partial<MemCell> = {},
  score = 0.95,
): MemCellSearchResult {
  return {
    entry: makeCell(overrides),
    score,
  };
}

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

describe("contentHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = contentHash("hello world");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(contentHash("hello world")).toBe(contentHash("hello world"));
  });

  it("trims and lowercases input before hashing", () => {
    const a = contentHash("  Hello World  ");
    const b = contentHash("hello world");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    expect(contentHash("abc")).not.toBe(contentHash("xyz"));
  });

  it("handles empty string", () => {
    const hash = contentHash("");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// stableNumericId
// ---------------------------------------------------------------------------

describe("stableNumericId", () => {
  it("returns a positive integer within safe integer range", () => {
    const id = stableNumericId("hello world");
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("is deterministic for the same input", () => {
    expect(stableNumericId("hello world")).toBe(
      stableNumericId("hello world"),
    );
  });

  it("produces different IDs for different inputs", () => {
    expect(stableNumericId("abc")).not.toBe(stableNumericId("xyz"));
  });

  it("does NOT trim or lowercase (raw input)", () => {
    // Unlike contentHash, stableNumericId uses raw text
    const upper = stableNumericId("Hello");
    const lower = stableNumericId("hello");
    // They should differ because MD5 of "Hello" != MD5 of "hello"
    expect(upper).not.toBe(lower);
  });

  it("handles empty string", () => {
    const id = stableNumericId("");
    expect(Number.isInteger(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDuplicate
// ---------------------------------------------------------------------------

describe("isDuplicate", () => {
  it("returns true when similarity meets the default threshold (0.92)", () => {
    expect(isDuplicate(0.92)).toBe(true);
    expect(isDuplicate(0.95)).toBe(true);
    expect(isDuplicate(1.0)).toBe(true);
  });

  it("returns false when similarity is below default threshold", () => {
    expect(isDuplicate(0.91)).toBe(false);
    expect(isDuplicate(0.5)).toBe(false);
    expect(isDuplicate(0)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isDuplicate(0.75, 0.75)).toBe(true);
    expect(isDuplicate(0.74, 0.75)).toBe(false);
    expect(isDuplicate(0.0, 0.0)).toBe(true); // edge: everything is a dupe
  });

  it("handles edge case of exact boundary", () => {
    // >= threshold means the threshold itself counts
    expect(isDuplicate(0.92)).toBe(true);
    expect(isDuplicate(0.92, 0.92)).toBe(true);
  });

  it("handles negative similarity as false", () => {
    expect(isDuplicate(-0.1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectConflict
// ---------------------------------------------------------------------------

describe("detectConflict", () => {
  it("returns no conflict when similarity is below 0.70", () => {
    const result = detectConflict("likes coffee", "doesn't like coffee", 0.6);
    expect(result.isConflict).toBe(false);
  });

  it("returns no conflict when similarity is >= 0.92 (handled by dedup)", () => {
    const result = detectConflict("likes coffee", "doesn't like coffee", 0.95);
    expect(result.isConflict).toBe(false);
  });

  it("detects conflict when one text negates and the other affirms", () => {
    // existing affirms, new negates
    const r1 = detectConflict("likes coffee", "doesn't like coffee", 0.85);
    expect(r1.isConflict).toBe(true);
    expect(r1.reason).toBe(
      "Potential contradiction: existing affirms, new negates",
    );

    // existing negates, new affirms
    const r2 = detectConflict("doesn't like coffee", "likes coffee", 0.85);
    expect(r2.isConflict).toBe(true);
    expect(r2.reason).toBe(
      "Potential contradiction: existing negates, new affirms",
    );
  });

  it("returns no conflict when both texts have negation words", () => {
    const result = detectConflict(
      "doesn't like tea",
      "never liked tea",
      0.85,
    );
    expect(result.isConflict).toBe(false);
  });

  it("returns no conflict when neither text has negation words", () => {
    const result = detectConflict("likes coffee", "enjoys coffee", 0.85);
    expect(result.isConflict).toBe(false);
  });

  it("recognises the full set of negation words", () => {
    const negations = [
      "not",
      "no",
      "never",
      "don't",
      "doesn't",
      "isn't",
      "wasn't",
      "aren't",
      "won't",
      "can't",
      "shouldn't",
      "hate",
      "dislike",
      "stop",
      "remove",
      "delete",
    ];

    for (const neg of negations) {
      const r = detectConflict("likes ice cream", `${neg} like ice cream`, 0.85);
      expect(r.isConflict).toBe(true);
    }
  });

  it("returns no conflict when similarity is exactly 0.70 or 0.92 boundary", () => {
    // Exactly 0.70 is inside the conflict zone (similarity >= 0.70 and < 0.92)
    const r1 = detectConflict("likes coffee", "doesn't like coffee", 0.7);
    expect(r1.isConflict).toBe(true);

    // Exactly 0.92 is outside (>= 0.92 means dedup, not conflict)
    const r2 = detectConflict("likes coffee", "doesn't like coffee", 0.92);
    expect(r2.isConflict).toBe(false);
  });

  it("includes a descriptive reason when conflict is detected", () => {
    const result = detectConflict("affirms this", "not affirms this", 0.8);
    expect(result.isConflict).toBe(true);
    expect(result.reason).toBe(
      "Potential contradiction: existing affirms, new negates",
    );
  });
});

// ---------------------------------------------------------------------------
// shouldSemanticMerge
// ---------------------------------------------------------------------------

describe("shouldSemanticMerge", () => {
  it("returns shouldMerge=true when score > 0.92 and same memoryType", () => {
    const existing = makeSearchResult({ id: "old-1", memoryType: "semantic" }, 0.95);
    const result = shouldSemanticMerge(existing, "new text", "semantic");

    expect(result.shouldMerge).toBe(true);
    expect(result.dropId).toBe("old-1");
    expect(result.mergedMetadata).toBeDefined();
    expect(result.mergedMetadata!.merged_from).toBe("old-1");
  });

  it("returns shouldMerge=false when score < 0.92", () => {
    const existing = makeSearchResult({ id: "old-1", memoryType: "semantic" }, 0.8);
    const result = shouldSemanticMerge(existing, "new text", "semantic");

    expect(result.shouldMerge).toBe(false);
    expect(result.dropId).toBe("");
  });

  it("returns shouldMerge=false when memoryType differs", () => {
    const existing = makeSearchResult({ id: "old-1", memoryType: "episodic" }, 0.95);
    const result = shouldSemanticMerge(existing, "new text", "semantic");

    expect(result.shouldMerge).toBe(false);
    expect(result.dropId).toBe("");
  });

  it("returns shouldMerge=false when both score low AND type differs", () => {
    const existing = makeSearchResult({ id: "old-1", memoryType: "episodic" }, 0.5);
    const result = shouldSemanticMerge(existing, "new text", "preference");

    expect(result.shouldMerge).toBe(false);
    expect(result.dropId).toBe("");
  });

  it("populates mergedMetadata with old values", () => {
    const existing = makeSearchResult(
      {
        id: "old-42",
        memoryType: "preference",
        text: "old preference text for testing",
        importance: 0.9,
        accessCount: 15,
      },
      0.98,
    );
    const result = shouldSemanticMerge(existing, "new text", "preference");

    expect(result.mergedMetadata!.merged_from).toBe("old-42");
    expect(result.mergedMetadata!.merged_old_text).toBe(
      "old preference text for testing",
    );
    expect(result.mergedMetadata!.merged_old_importance).toBe(0.9);
    expect(result.mergedMetadata!.merged_old_access_count).toBe(15);
    expect(typeof result.mergedMetadata!.merged_at).toBe("string");
  });

  it("truncates merged_old_text to 200 characters", () => {
    const longText = "x".repeat(500);
    const existing = makeSearchResult(
      { id: "old-1", memoryType: "semantic", text: longText },
      0.95,
    );
    const result = shouldSemanticMerge(existing, "new", "semantic");

    expect(result.mergedMetadata!.merged_old_text).toHaveLength(200);
  });

  it("handles exact boundary score of 0.92 (should merge)", () => {
    const existing = makeSearchResult({ id: "old-1", memoryType: "profile" }, 0.92);
    const result = shouldSemanticMerge(existing, "new", "profile");

    expect(result.shouldMerge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMergedPayload
// ---------------------------------------------------------------------------

describe("buildMergedPayload", () => {
  it("takes the max of existing and new importance", () => {
    const existing = makeCell({ importance: 0.5, accessCount: 3, linkedMemories: ["mem-a"] });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
      mergedMetadata: { merged_from: "old-1" },
    };

    // new importance is higher
    const payload = buildMergedPayload(existing, 0.9, mergeResult);
    expect(payload.importance).toBe(0.9);

    // existing importance is higher
    const existing2 = makeCell({ importance: 0.9, accessCount: 3, linkedMemories: ["mem-a"] });
    const payload2 = buildMergedPayload(existing2, 0.5, mergeResult);
    expect(payload2.importance).toBe(0.9);
  });

  it("carries forward existing accessCount", () => {
    const existing = makeCell({ accessCount: 42, linkedMemories: [] });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
    };

    const payload = buildMergedPayload(existing, 0.7, mergeResult);
    expect(payload.accessCount).toBe(42);
  });

  it("appends existing id to linkedMemories", () => {
    const existing = makeCell({
      id: "old-1",
      linkedMemories: ["mem-a", "mem-b"],
    });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
    };

    const payload = buildMergedPayload(existing, 0.7, mergeResult);
    expect(payload.linkedMemories).toEqual(["mem-a", "mem-b", "old-1"]);
  });

  it("sets metadata from mergeResult.mergedMetadata", () => {
    const existing = makeCell({ linkedMemories: [] });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
      mergedMetadata: { merged_from: "old-1", merged_at: "2025-01-01T00:00:00Z" },
    };

    const payload = buildMergedPayload(existing, 0.7, mergeResult);
    expect(payload.metadata).toEqual(mergeResult.mergedMetadata);
  });

  it("returns empty object for metadata when mergedMetadata is undefined", () => {
    const existing = makeCell({ linkedMemories: [] });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
    };

    const payload = buildMergedPayload(existing, 0.7, mergeResult);
    expect(payload.metadata).toEqual({});
  });

  it("handles existing with empty linkedMemories", () => {
    const existing = makeCell({ id: "old-1", linkedMemories: [], importance: 0.3, accessCount: 0 });
    const mergeResult: SemanticMergeResult = {
      shouldMerge: true,
      dropId: "old-1",
    };

    const payload = buildMergedPayload(existing, 0.5, mergeResult);
    expect(payload.linkedMemories).toEqual(["old-1"]);
    expect(payload.importance).toBe(0.5);
    expect(payload.accessCount).toBe(0);
  });
});
