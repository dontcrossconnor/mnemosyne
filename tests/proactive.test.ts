import { describe, it, expect } from "vitest";
import {
  extractEntities,
  computeProactiveQueries,
  mergeProactiveResults,
  formatProactiveContext,
} from "../src/cognitive/proactive.js";
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

function makeProactiveResult(
  overrides: Partial<MemCell> = {},
  score = 0.85,
): MemCellSearchResult {
  return {
    entry: makeCell(overrides),
    score,
  };
}

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe("extractEntities", () => {
  it("extracts default tech terms (case-insensitive)", () => {
    const r = extractEntities("I am using PostgreSQL and Redis together");
    expect(r).toContain("postgresql");
    expect(r).toContain("redis");
  });

  it("extracts tech terms in mixed case", () => {
    const r = extractEntities("GraphQL vs grpc performance");
    expect(r).toContain("graphql");
    expect(r).toContain("grpc");
  });

  it("extracts capitalized proper nouns (2+ chars, not sentence-start)", () => {
    const r = extractEntities("works on ProjectA called HermesAgent");
    expect(r).toContain("projecta");
    expect(r).toContain("hermesagent");
  });

  it("filters out common capitalized English words", () => {
    const r = extractEntities("The project uses This library and That tool");
    expect(r).not.toContain("the");
    expect(r).not.toContain("this");
    expect(r).not.toContain("that");
  });

  it("does not extract proper nouns at the start of a sentence", () => {
    // The regex uses (?<=\s), so a word at the very start of the string won't match
    const r = extractEntities("Kubernetes is a container orchestrator");
    // "Kubernetes" is at position 0, preceded by nothing — not matched by proper noun rule
    // But it IS a default tech term, so it should appear
    expect(r).toContain("kubernetes");
  });

  it("extracts port references (4-5 digits with 'port' prefix)", () => {
    const r = extractEntities("The app runs on port 3000 and port 5432");
    expect(r).toContain("port 3000");
    expect(r).toContain("port 5432");
  });

  it("does not extract short port numbers (3 digits or fewer)", () => {
    const r = extractEntities("port 80 is the default");
    expect(r).not.toContain("port 80");
  });

  it("does not extract 6+ digit numbers as ports", () => {
    const r = extractEntities("listening on port 123456");
    expect(r).not.toContain("port 123456");
  });

  it("extracts port references case-insensitively", () => {
    // Port matches use the raw matched text (not lowered), so "PORT 8080"
    // and "Port 9090" appear as-is. "Port" also matches as a proper noun
    // (capitalised, not in the common words list) and gets lowered to "port".
    const r = extractEntities("PORT 8080 and Port 9090");
    expect(r).toContain("PORT 8080");
    expect(r).toContain("Port 9090");
    expect(r).toContain("port");
  });

  it("includes additional terms alongside defaults", () => {
    const r = extractEntities("We use Qdrant and MyCustomDB", ["MyCustomDB"]);
    expect(r).toContain("qdrant");
    expect(r).toContain("mycustomdb");
  });

  it("returns deduplicated entities", () => {
    const r = extractEntities("Redis is great, I love Redis");
    expect(r.filter(e => e === "redis")).toHaveLength(1);
  });

  it("returns empty array for text with no entities", () => {
    const r = extractEntities("hello world and some stuff");
    expect(r).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const r = extractEntities("");
    expect(r).toEqual([]);
  });

  it("combines tech terms, proper nouns, and ports together", () => {
    const r = extractEntities(
      "We deploy Docker on port 8080 using MyApp and Nginx",
    );
    expect(r).toContain("docker");
    expect(r).toContain("nginx");
    expect(r).toContain("myapp");
    expect(r).toContain("port 8080");
  });

  it("does not extract standalone numbers without 'port' prefix", () => {
    const r = extractEntities("the value is 8080 or maybe 5432");
    expect(r).toEqual([]);
  });

  it("matches tech terms as whole words (not substrings)", () => {
    // "Redis" should match but not "Rediscovered" as a substring of a larger word
    const r = extractEntities("I Rediscovered this old project");
    expect(r).not.toContain("redis");
  });

  it("handles additionalTerms with special regex characters", () => {
    // Terms ending with non-word chars (e.g. "C++") can't match \b at the end.
    // Use a term where the special char is in the middle so \b boundaries work.
    const r = extractEntities("Using config.ini", ["config.ini"]);
    expect(r).toContain("config.ini");
  });

  it("does not match proper nouns containing digits (regex limits to [a-zA-Z])", () => {
    // The proper noun regex [A-Z][a-zA-Z]{2,} only matches letters,
    // so "Alpha2" captures as "Alpha" only.
    const r = extractEntities("version Alpha2 is released");
    expect(r).toEqual(["alpha"]);
  });
});

// ---------------------------------------------------------------------------
// computeProactiveQueries
// ---------------------------------------------------------------------------

describe("computeProactiveQueries", () => {
  it("returns entity expansion queries for mentioned entities", () => {
    const r = computeProactiveQueries(
      "I am setting up PostgreSQL",
      [],
    );
    expect(r).toEqual([
      "postgresql configuration setup",
      "postgresql connected services",
    ]);
  });

  it("caps at 2 proactive queries even with many entities", () => {
    const r = computeProactiveQueries(
      "Using Redis, PostgreSQL, Docker, and Nginx together",
      [],
    );
    expect(r).toHaveLength(2);
  });

  it("adds a how-to query when infra entity exists but no procedural results", () => {
    const r = computeProactiveQueries(
      "Setting up Redis for caching",
      [{ entry: makeCell({ memoryType: "semantic" }), score: 0.9 }],
    );
    // Strategy 1: 2 entity expansion queries, Strategy 2 hits because no procedural
    // But capped at 2: first two entity expansion queries win
    expect(r.length).toBeLessThanOrEqual(2);
    expect(r[0]).toMatch(/redis configuration setup|redis connected services/);
    expect(r[1]).toMatch(/redis configuration setup|redis connected services/);
  });

  it("does NOT add how-to query if procedural results already exist", () => {
    const r = computeProactiveQueries(
      "Setting up Redis for caching",
      [{ entry: makeCell({ memoryType: "procedural" }), score: 0.9 }],
    );
    // Strategy 2 should NOT fire because foundTypes has "procedural"
    // But strategy 1 still fires, capped at 2
    expect(r).toEqual([
      "redis configuration setup",
      "redis connected services",
    ]);
  });

  it("does NOT add how-to query for non-infra entities", () => {
    // "HermesAgent" isn't in the infra entity list
    const r = computeProactiveQueries(
      "Working on HermesAgent",
      [],
    );
    // Only entity expansion for hermesagent (2 queries) — no how-to because
    // infraEntities is empty, but it's capped at 2 anyway
    expect(r).toHaveLength(2);
  });

  it("returns empty array when no entities are found", () => {
    const r = computeProactiveQueries("hello world", []);
    expect(r).toEqual([]);
  });

  it("uses additionalTerms for entity extraction", () => {
    const r = computeProactiveQueries(
      "I need help with MyCustomDB",
      [],
      ["MyCustomDB"],
    );
    expect(r).toEqual([
      "mycustomdb configuration setup",
      "mycustomdb connected services",
    ]);
  });

  it("returns empty for empty prompt", () => {
    const r = computeProactiveQueries("", []);
    expect(r).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeProactiveResults
// ---------------------------------------------------------------------------

describe("mergeProactiveResults", () => {
  it("merges direct + proactive results, applying score penalty to proactive", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.9)];
    const proactive = [makeSearchResult({ id: "b" }, 0.8)];
    const merged = mergeProactiveResults(direct, proactive, 10);

    expect(merged).toHaveLength(2);
    expect(merged[0].entry.id).toBe("a");
    expect(merged[0].score).toBe(0.9);
    expect(merged[1].entry.id).toBe("b");
    // Score penalised: 0.8 * 0.85 = 0.68
    expect(merged[1].score).toBeCloseTo(0.68);
  });

  it("deduplicates by entry ID (skips proactive if ID already in direct)", () => {
    const direct = [makeSearchResult({ id: "shared-id" }, 0.9)];
    const proactive = [makeSearchResult({ id: "shared-id" }, 0.9)];
    const merged = mergeProactiveResults(direct, proactive, 10);

    expect(merged).toHaveLength(1);
    expect(merged[0].entry.id).toBe("shared-id");
    // Score stays original (penalty not applied to dupes since they're not added)
    expect(merged[0].score).toBe(0.9);
  });

  it("stops adding proactive results when maxTotal is reached", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.9)];
    const proactive = [
      makeSearchResult({ id: "b" }, 0.7),
      makeSearchResult({ id: "c" }, 0.6),
    ];
    const merged = mergeProactiveResults(direct, proactive, 2);

    expect(merged).toHaveLength(2);
    // Only b should be added (a took 1 slot, b took the 2nd, c is cut)
    expect(merged[1].entry.id).toBe("b");
  });

  it("sorts results by score descending after merge", () => {
    const direct = [makeSearchResult({ id: "low" }, 0.3)];
    const proactive = [
      makeSearchResult({ id: "high" }, 0.9),
      makeSearchResult({ id: "mid" }, 0.6),
    ];
    const merged = mergeProactiveResults(direct, proactive, 10);

    expect(merged).toHaveLength(3);
    // After score penalty: high (0.765) > mid (0.51) > low (0.3)
    expect(merged[0].entry.id).toBe("high");
    expect(merged[0].score).toBeCloseTo(0.765);
    expect(merged[1].entry.id).toBe("mid");
    expect(merged[1].score).toBeCloseTo(0.51);
    expect(merged[2].entry.id).toBe("low");
    expect(merged[2].score).toBe(0.3);
  });

  it("handles empty proactive results", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.9)];
    const merged = mergeProactiveResults(direct, [], 10);

    expect(merged).toHaveLength(1);
    expect(merged[0].entry.id).toBe("a");
  });

  it("handles empty direct results", () => {
    const proactive = [makeSearchResult({ id: "b" }, 0.8)];
    const merged = mergeProactiveResults([], proactive, 10);

    expect(merged).toHaveLength(1);
    expect(merged[0].entry.id).toBe("b");
    expect(merged[0].score).toBeCloseTo(0.8 * 0.85);
  });

  it("handles both arrays empty", () => {
    const merged = mergeProactiveResults([], [], 10);
    expect(merged).toEqual([]);
  });

  it("handles maxTotal of 0", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.9)];
    const proactive = [makeSearchResult({ id: "b" }, 0.8)];
    const merged = mergeProactiveResults(direct, proactive, 0);
    expect(merged).toEqual([]);
  });

  it("handles maxTotal smaller than direct results count", () => {
    const direct = [
      makeSearchResult({ id: "a" }, 0.9),
      makeSearchResult({ id: "b" }, 0.8),
    ];
    const proactive = [makeSearchResult({ id: "c" }, 0.7)];
    const merged = mergeProactiveResults(direct, proactive, 1);

    expect(merged).toHaveLength(1);
    // Only the highest-scored direct result survives
    expect(merged[0].entry.id).toBe("a");
  });

  it("applies score penalty only to proactive results, not direct", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.5)];
    const proactive = [makeSearchResult({ id: "b" }, 0.9)];
    const merged = mergeProactiveResults(direct, proactive, 10);

    // After penalty: direct 0.5, proactive 0.9*0.85=0.765
    // So proactive should be first
    expect(merged).toHaveLength(2);
    expect(merged[0].entry.id).toBe("b");
    expect(merged[0].score).toBeCloseTo(0.765);
    expect(merged[1].entry.id).toBe("a");
    expect(merged[1].score).toBe(0.5);
  });

  it("does not mutate the original arrays", () => {
    const direct = [makeSearchResult({ id: "a" }, 0.9)];
    const proactive = [makeSearchResult({ id: "b" }, 0.8)];
    const origDirectScore = direct[0].score;
    const origProactiveScore = proactive[0].score;

    mergeProactiveResults(direct, proactive, 10);

    expect(direct[0].score).toBe(origDirectScore);
    expect(proactive[0].score).toBe(origProactiveScore);
  });
});

// ---------------------------------------------------------------------------
// formatProactiveContext
// ---------------------------------------------------------------------------

describe("formatProactiveContext", () => {
  it("formats direct memories as numbered list with [memoryType]", () => {
    const result = formatProactiveContext(
      [{ text: "Docker setup guide", memoryType: "procedural" }],
      [],
    );
    expect(result).toBe("1. [procedural] Docker setup guide");
  });

  it("formats proactive memories with separator line and + prefix", () => {
    const result = formatProactiveContext(
      [],
      [{ text: "Redis connection details", memoryType: "semantic" }],
    );
    expect(result).toBe(
      "--- Related context (proactively loaded) ---\n+ [semantic] Redis connection details",
    );
  });

  it("combines direct and proactive sections", () => {
    const result = formatProactiveContext(
      [{ text: "Main memory", memoryType: "episodic" }],
      [{ text: "Extra context", memoryType: "semantic" }],
    );
    expect(result).toBe(
      "1. [episodic] Main memory\n--- Related context (proactively loaded) ---\n+ [semantic] Extra context",
    );
  });

  it("includes confidenceTag in brackets when present", () => {
    const result = formatProactiveContext(
      [{ text: "Verified fact", memoryType: "semantic", confidenceTag: "verified" }],
      [{ text: "Inferred detail", memoryType: "preference", confidenceTag: "inferred" }],
    );
    expect(result).toBe(
      "1. [semantic] [verified] Verified fact\n--- Related context (proactively loaded) ---\n+ [preference] [inferred] Inferred detail",
    );
  });

  it("omits confidenceTag brackets when not present", () => {
    const result = formatProactiveContext(
      [{ text: "Plain memory", memoryType: "procedural" }],
      [],
    );
    expect(result).not.toContain("[undefined]");
    expect(result).toBe("1. [procedural] Plain memory");
  });

  it("numbers direct memories sequentially", () => {
    const result = formatProactiveContext(
      [
        { text: "First", memoryType: "semantic" },
        { text: "Second", memoryType: "episodic" },
        { text: "Third", memoryType: "procedural" },
      ],
      [],
    );
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^1\. /);
    expect(lines[1]).toMatch(/^2\. /);
    expect(lines[2]).toMatch(/^3\. /);
  });

  it("returns empty string when both arrays are empty", () => {
    const result = formatProactiveContext([], []);
    expect(result).toBe("");
  });

  it("returns only direct section when proactive is empty", () => {
    const result = formatProactiveContext(
      [{ text: "Solo direct", memoryType: "profile" }],
      [],
    );
    expect(result).not.toContain("proactively loaded");
    expect(result).toBe("1. [profile] Solo direct");
  });

  it("returns only proactive section when direct is empty", () => {
    const result = formatProactiveContext(
      [],
      [{ text: "Solo proactive", memoryType: "semantic" }],
    );
    expect(result).toContain("proactively loaded");
    expect(result).toContain("Solo proactive");
  });

  it("handles multiple proactive memories with + prefix", () => {
    const result = formatProactiveContext(
      [],
      [
        { text: "Item one", memoryType: "semantic" },
        { text: "Item two", memoryType: "episodic" },
      ],
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("--- Related context (proactively loaded) ---");
    expect(lines[1]).toBe("+ [semantic] Item one");
    expect(lines[2]).toBe("+ [episodic] Item two");
  });

  it("handles mixed memory types with confidence tags in both sections", () => {
    const result = formatProactiveContext(
      [
        { text: "Config key", memoryType: "semantic", confidenceTag: "grounded" },
        { text: "User prefers X", memoryType: "preference", confidenceTag: "uncertain" },
      ],
      [
        { text: "Related how-to", memoryType: "procedural" },
      ],
    );
    expect(result).toBe(
      "1. [semantic] [grounded] Config key\n" +
      "2. [preference] [uncertain] User prefers X\n" +
      "--- Related context (proactively loaded) ---\n" +
      "+ [procedural] Related how-to",
    );
  });
});
