import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findWarningLessons,
  findPatternPredictions,
  findPreferenceReminders,
  formatWarningContext,
} from "../src/cognitive/warnings.js";
import type { Pattern } from "../src/cognitive/pattern-miner.js";
import type { UserModel, Preference } from "../src/cognitive/preferences.js";
import type { ProactiveSuggestion } from "../src/cognitive/warnings.js";

// ============================================================================
// Helpers
// ============================================================================

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: "pat-1",
    type: "recurring_error",
    description: "Node process runs out of memory when handling large CSV files",
    confidence: 0.85,
    occurrences: 12,
    evidenceIds: ["mem-1", "mem-2"],
    firstSeen: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    tags: ["node", "memory", "csv"],
    metadata: {},
    ...overrides,
  };
}

function makePreference(overrides: Partial<Preference> = {}): Preference {
  return {
    key: "language:typescript",
    category: "language",
    value: "prefers TypeScript over JavaScript",
    strength: 0.9,
    evidenceCount: 5,
    firstSeen: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeen: new Date().toISOString(),
    sources: ["mem-1", "mem-2", "mem-3"],
    ...overrides,
  };
}

function makeUserModel(preferences: Map<string, Preference>): UserModel {
  return {
    userId: "user-test",
    agentId: "agent-test",
    preferences,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

function makeSuggestion(overrides: Partial<ProactiveSuggestion> = {}): ProactiveSuggestion {
  return {
    type: "warning",
    priority: "medium",
    text: "Test warning",
    evidence: ["mem-1"],
    source: "lesson",
    score: 0.7,
    ...overrides,
  };
}

// ============================================================================
// findWarningLessons
// ============================================================================

describe("findWarningLessons", () => {
  const qdrantUrl = "http://qdrant:6333";
  const promptVector = [0.1, 0.2, 0.3];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns suggestions from Qdrant response", async () => {
    const mockResponse = {
      result: [
        {
          id: "lesson-1",
          score: 0.85,
          payload: {
            text: "Always validate input before passing to exec()",
            metadata: { lesson_type: "anti_pattern", source: "lesson_extraction" },
            created_at: new Date().toISOString(),
          },
        },
        {
          id: "lesson-2",
          score: 0.65,
          payload: {
            text: "Use connection pooling for PostgreSQL",
            metadata: { lesson_type: "gotcha", source: "lesson_extraction" },
            created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
          },
        },
        {
          id: "lesson-3",
          score: 0.55,
          payload: {
            text: "Remember to set timeouts on HTTP clients",
            metadata: { lesson_type: "technique", source: "lesson_extraction" },
            created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
          },
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toHaveLength(3);

    // lesson-1: score 0.85 >= 0.75 -> high priority, anti_pattern -> type="warning"
    expect(results[0]).toMatchObject({
      type: "warning",
      priority: "high",
      text: "Always validate input before passing to exec()",
      evidence: ["lesson-1"],
      source: "lesson",
    });
    expect(results[0].score).toBeCloseTo(0.85 * 1.0, 5); // recency=1.0 (same day)

    // lesson-2: score 0.65 >= 0.6 -> medium, gotcha -> type="warning"
    expect(results[1]).toMatchObject({
      type: "warning",
      priority: "medium",
      text: "Use connection pooling for PostgreSQL",
      source: "lesson",
    });
    expect(results[1].score).toBeCloseTo(0.65 * 1.0, 5); // recency=1.0 (within 1 day)

    // lesson-3: score 0.55 < 0.6 -> low priority, technique -> type="reminder"
    expect(results[2]).toMatchObject({
      type: "reminder",
      priority: "low",
      text: "Remember to set timeouts on HTTP clients",
      source: "lesson",
    });
    expect(results[2].score).toBeCloseTo(0.55 * 0.75, 5); // recency=0.75 (10 days)

    expect(fetch).toHaveBeenCalledTimes(1);
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe(`${qdrantUrl}/collections/memory_shared/points/search`);
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.vector).toEqual(promptVector);
    expect(body.limit).toBe(5);
    expect(body.score_threshold).toBe(0.55);
  });

  it("returns empty array when fetch fails (non-ok)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error (timeout/network)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toEqual([]);
  });

  it("filters out results below minScore threshold", async () => {
    const mockResponse = {
      result: [
        { id: "l1", score: 0.9, payload: { text: "Hi", metadata: {}, created_at: new Date().toISOString() } },
        { id: "l2", score: 0.5, payload: { text: "Lo", metadata: {}, created_at: new Date().toISOString() } },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    }));

    // minScore=0.8 should drop l2
    const results = await findWarningLessons(qdrantUrl, promptVector, 0.8);
    expect(results).toHaveLength(1);
    expect(results[0].evidence).toEqual(["l1"]);
  });

  it("honours custom minScore parameter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: [] }),
    }));

    await findWarningLessons(qdrantUrl, promptVector, 0.3);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
    expect(body.score_threshold).toBe(0.3);
  });

  it("handles empty result list gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: [] }),
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toEqual([]);
  });

  it("handles null result gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toEqual([]);
  });

  it("handles missing text in payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l1", score: 0.9, payload: { metadata: {}, created_at: new Date().toISOString() } },
        ],
      }),
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("");
  });

  it("uses recency weight in score calculation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          {
            id: "old-lesson",
            score: 0.9,
            payload: {
              text: "Old lesson",
              metadata: { lesson_type: "gotcha" },
              created_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(), // 200 days ago
            },
          },
        ],
      }),
    }));

    const results = await findWarningLessons(qdrantUrl, promptVector);
    expect(results).toHaveLength(1);
    // 200 days -> recency=0.5
    expect(results[0].score).toBeCloseTo(0.9 * 0.5, 5);
  });

  it("sends Qdrant filter for lesson_extraction and non-deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: [] }),
    }));

    await findWarningLessons(qdrantUrl, promptVector);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
    expect(body.filter).toEqual({
      must: [
        { key: "deleted", match: { value: false } },
        { key: "metadata.source", match: { value: "lesson_extraction" } },
      ],
    });
  });

  it("sends AbortSignal.timeout(80) in fetch options", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: [] }),
    }));

    await findWarningLessons(qdrantUrl, promptVector);
    const options = vi.mocked(fetch).mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

// ============================================================================
// findPatternPredictions
// ============================================================================

describe("findPatternPredictions", () => {
  it("returns empty array when patterns array is empty", () => {
    const results = findPatternPredictions("build the project", []);
    expect(results).toEqual([]);
  });

  it("returns empty array when userPrompt is empty", () => {
    const results = findPatternPredictions("", [makePattern()]);
    expect(results).toEqual([]);
  });

  it("returns empty array when userPrompt is whitespace only", () => {
    const results = findPatternPredictions("   ", [makePattern()]);
    expect(results).toEqual([]);
  });

  it("skips non-prediction pattern types (co_occurrence, cluster, anomaly)", () => {
    const patterns: Pattern[] = [
      makePattern({ id: "p1", type: "co_occurrence", description: "Docker and Redis appear together" }),
      makePattern({ id: "p2", type: "cluster", description: "Bunch of deployment memories" }),
      makePattern({ id: "p3", type: "anomaly", description: "Unusual spike in error logs" }),
    ];

    const results = findPatternPredictions("Docker Redis deployment error", patterns);
    expect(results).toEqual([]);
  });

  it("finds matching recurring_error pattern", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "pat-err",
        type: "recurring_error",
        description: "Node process runs out of memory when handling large CSV files",
        confidence: 0.85,
        occurrences: 12,
        evidenceIds: ["mem-1", "mem-2", "mem-3", "mem-4", "mem-5", "mem-6"],
      }),
    ];

    const results = findPatternPredictions(
      "the node process crashed while processing a large CSV upload",
      patterns,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "warning",
      source: "pattern",
      evidence: ["mem-1", "mem-2", "mem-3", "mem-4", "mem-5"],
    });
    expect(results[0].text).toContain("Warning:");
    expect(results[0].text).toContain("12 times");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("categorizes sequence and correlation patterns as prediction type", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "pat-seq",
        type: "sequence",
        description: "Deploy staging before production deployment",
        confidence: 0.75,
        occurrences: 8,
        lastSeen: new Date().toISOString(),
      }),
      makePattern({
        id: "pat-corr",
        type: "correlation",
        description: "High CPU usage correlates with memory pressure",
        confidence: 0.6,
        occurrences: 5,
        lastSeen: new Date().toISOString(),
      }),
    ];

    const results = findPatternPredictions(
      "deploy production with high cpu usage",
      patterns,
    );

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("prediction");
    expect(results[1].type).toBe("prediction");
    expect(results[0].text).toContain("Pattern:");
    expect(results[0].text).toContain("75% confidence");
  });

  it("requires at least 2 keyword matches OR 40% overlap", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "p-low",
        type: "recurring_error",
        description: "PostgreSQL connection pool exhaustion under high load",
        confidence: 0.9,
      }),
    ];

    // Only "connection" and "load" match out of many words -> matchCount=2, so 2/6=33% overlap
    // matchCount >= 2 == true -> PASSES
    const results = findPatternPredictions(
      "check the database connection under test load",
      patterns,
    );

    expect(results).toHaveLength(1);
  });

  it("fails match when fewer than 2 keyword matches AND < 40% overlap", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "p-no",
        type: "recurring_error",
        description: "PostgreSQL connection pool exhaustion under high load",
        confidence: 0.9,
      }),
    ];

    // Only "database" matches out of many -> matchCount=1, 1/6=16% -> both conditions fail
    const results = findPatternPredictions(
      "set up the database server",
      patterns,
    );

    expect(results).toHaveLength(0);
  });

  it("passes with high overlap even if matchCount < 2", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "p-overlap",
        type: "recurring_error",
        description: "rust build times are slow",
        confidence: 0.7,
      }),
    ];

    // "rust", "build", "slow" from prompt match "rust", "build", "slow" in description
    //   but "are" and "times" are <= 3 chars so filtered
    // Actually desc words: rust(4), build(5), times(5), are(3-filtered), slow(4)
    // descWords = ["rust", "build", "times", "slow"] (are filtered out)
    // prompt words: "rust", "build", "times", "slow"
    // Wait, prompt: "rust build times slow" -> promptWords: {"rust", "build", "times", "slow"}
    // matchCount=4, overlap=4/4=100% -> passes
    const results = findPatternPredictions(
      "rust build times slow",
      patterns,
    );

    expect(results).toHaveLength(1);
  });

  it("computes priority based on score thresholds", () => {
    const highScore = findPatternPredictions(
      "node process runs memory handling large files processing crash",
      [
        makePattern({
          id: "p-high",
          type: "recurring_error",
          description: "Node process runs out of memory when handling large CSV files",
          confidence: 0.95,
          lastSeen: new Date().toISOString(),
        }),
      ],
    );
    expect(highScore[0].priority).toBe("high");

    const medScore = findPatternPredictions(
      "node process runs memory handling",
      [
        makePattern({
          id: "p-med",
          type: "recurring_error",
          description: "Node process runs out of memory when handling large CSV files",
          confidence: 0.6,
          lastSeen: new Date().toISOString(),
        }),
      ],
    );
    expect(medScore[0].priority).toBe("medium");

    const lowScore = findPatternPredictions(
      "node handling",
      [
        makePattern({
          id: "p-low",
          type: "recurring_error",
          description: "Node process runs out of memory when handling large CSV files",
          confidence: 0.3,
          lastSeen: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    );
    expect(lowScore[0].priority).toBe("low");
  });

  it("applies recency weight to score", () => {
    const recentPattern = makePattern({
      id: "p-recent",
      type: "recurring_error",
      description: "deploy fails when config missing",
      confidence: 0.5,
      lastSeen: new Date().toISOString(),
    });

    const oldPattern = makePattern({
      id: "p-old",
      type: "recurring_error",
      description: "deploy fails when config missing",
      confidence: 0.5,
      lastSeen: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const prompt = "deploy config failing";
    const [, recentResult] = [findPatternPredictions(prompt, [oldPattern]), findPatternPredictions(prompt, [recentPattern])];
    // recentPattern matches: "config" and "failing" in prompt vs "config", "missing", "deploy", "fails" in desc
    // Actually descWords: deploy(6), fails(5), when(4), config(6), missing(7)
    // promptWords: deploy(6), config(6), failing(7)
    // matchCount: deploy, config = 2, matchRatio=2/5=0.4 -> passes (matchCount>=2)
    // For recent: score = 0.5 * 0.4 * 1.0 = 0.2
    // For old: score = 0.5 * 0.4 * 0.5 = 0.1

    const recentResults = findPatternPredictions(prompt, [recentPattern]);
    const oldResults = findPatternPredictions(prompt, [oldPattern]);

    expect(recentResults[0].score).toBeGreaterThan(oldResults[0].score);
  });

  it("limits evidence to first 5 IDs", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "p-evidence",
        type: "recurring_error",
        description: "test error pattern for evidence",
        evidenceIds: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    ];

    const results = findPatternPredictions("test error pattern evidence", patterns);
    expect(results[0].evidence).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("skips patterns with empty description after filtering short words", () => {
    const patterns: Pattern[] = [
      makePattern({
        id: "p-short",
        type: "recurring_error",
        description: "a an is it", // all words <= 3 chars -> descWords=[]
      }),
    ];

    const results = findPatternPredictions("a an is it to be", patterns);
    expect(results).toEqual([]);
  });

  it("handles multiple patterns with mixed match status", () => {
    const patterns: Pattern[] = [
      makePattern({ id: "p1", type: "recurring_error", description: "large CSV memory crash node", evidenceIds: ["p1"] }),
      makePattern({ id: "p2", type: "co_occurrence", description: "Docker Redis", evidenceIds: ["p2"] }), // skipped type
      makePattern({ id: "p3", type: "sequence", description: "deploy staging production", evidenceIds: ["p3"] }),
    ];

    const results = findPatternPredictions(
      "node memory deploy production",
      patterns,
    );
    // p1 matches: node, memory -> matchCount=2
    // p2 skipped (co_occurrence)
    // p3: deploy, production -> matchCount=2
    expect(results).toHaveLength(2);
    expect(results.map(r => r.evidence[0])).toEqual(["p1", "p3"]);
  });
});

// ============================================================================
// findPreferenceReminders
// ============================================================================

describe("findPreferenceReminders", () => {
  it("returns empty when model is null", () => {
    const results = findPreferenceReminders("build with typescript", null);
    expect(results).toEqual([]);
  });

  it("returns empty when model has no preferences", () => {
    const model = makeUserModel(new Map());
    const results = findPreferenceReminders("build with typescript", model);
    expect(results).toEqual([]);
  });

  it("returns empty when preference strength is below 0.4 threshold", () => {
    const pref = makePreference({ strength: 0.3 });
    const model = makeUserModel(new Map([["language:typescript", pref]]));
    const results = findPreferenceReminders("write this in typescript", model);
    expect(results).toEqual([]);
  });

  it("reminds about a matching preference with no conflict", () => {
    const pref = makePreference({
      key: "communication:brief",
      value: "prefers brief concise responses",
      strength: 0.8,
    });
    const model = makeUserModel(new Map([["communication:brief", pref]]));

    // prompt includes "brief concise" -> matchCount=2 >= 2, no conflict
    const results = findPreferenceReminders("give me a brief concise summary", model);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "reminder",
      priority: "low",
      source: "preference",
    });
    expect(results[0].text).toBe("Reminder: prefers brief concise responses");
    expect(results[0].score).toBeCloseTo(0.8 * 0.5, 5); // non-conflict multiplier
  });

  it("emits warning when preference and prompt indicate a conflict", () => {
    const pref = makePreference({
      key: "language:typescript",
      value: "prefers TypeScript over JavaScript",
    });
    const model = makeUserModel(new Map([["language:typescript", pref]]));

    // prompt mentions "javascript" (the opposite of typescript) without "typescript"
    const results = findPreferenceReminders("write this in javascript", model);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "warning",
      priority: "medium",
      source: "preference",
    });
    expect(results[0].text).toContain("Note:");
    expect(results[0].text).toContain("Your preference");
    expect(results[0].text).toContain("90%"); // strength 0.9
    expect(results[0].score).toBeCloseTo(0.9 * 0.8, 5); // conflict multiplier
  });

  it("does not flag conflict when both sides are mentioned", () => {
    const pref = makePreference({
      key: "language:typescript",
      value: "prefers TypeScript over JavaScript",
    });
    const model = makeUserModel(new Map([["language:typescript", pref]]));

    // prompt mentions both "typescript" and "javascript" -> not a conflict
    const results = findPreferenceReminders("compare typescript with javascript", model);
    expect(results[0].type).toBe("reminder"); // not warning
    expect(results[0].priority).toBe("low");
  });

  it("does not flag conflict when prompt matches the preferred side only", () => {
    const pref = makePreference({
      key: "language:typescript",
      value: "prefers TypeScript over JavaScript",
    });
    const model = makeUserModel(new Map([["language:typescript", pref]]));

    // "prefers typescript" -> matchCount=2 (prefers, typescript), no conflict
    const results = findPreferenceReminders("prefers typescript over everything", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("reminder");
  });

  it("detects conflict: pref prefers B, prompt mentions A", () => {
    const pref = makePreference({
      key: "tool:vscode",
      value: "prefers VSCode over vim",
    });
    const model = makeUserModel(new Map([["tool:vscode", pref]]));

    // prompt mentions "vim" (A in conflict pair ["vim","vscode"]) without also mentioning "vscode"
    // "tool" from pref key gives keyword matchCount >= 1 to pass the first check
    const results = findPreferenceReminders("use vim as a code editor tool", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("warning");
  });

  it("detects conflict: docker vs bare metal", () => {
    const pref = makePreference({
      key: "infra:docker",
      value: "prefers bare metal server",
    });
    const model = makeUserModel(new Map([["infra:docker", pref]]));

    // pref has "docker" in key, prompt says "bare metal" (the other side of the pair)
    // "bare" and "metal" are in allKeywords (from pref value) → matchCount >= 1
    const results = findPreferenceReminders("run on bare metal server", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("warning");
  });

  it("detects conflict: redis vs memcached", () => {
    const pref = makePreference({
      key: "cache:memcached",
      value: "prefers memcached over Redis",
    });
    const model = makeUserModel(new Map([["cache:memcached", pref]]));

    const results = findPreferenceReminders("add redis caching", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("warning");
  });

  it("detects conflict: postgres vs mysql", () => {
    const pref = makePreference({
      key: "database:mysql",
      value: "prefers MySQL over Postgres",
    });
    const model = makeUserModel(new Map([["database:mysql", pref]]));

    const results = findPreferenceReminders("use postgres for this project", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("warning");
  });

  it("detects conflict: concise vs verbose", () => {
    const pref = makePreference({
      key: "style:verbose",
      value: "prefers verbose explanations",
    });
    const model = makeUserModel(new Map([["style:verbose", pref]]));

    // pref has "verbose" in key, prompt says "concise" (the other side of the pair) + "style" for keyword match
    const results = findPreferenceReminders("this style is too concise", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("warning");
  });

  it("does not surface non-conflict with only 1 keyword match when matchCount < 2", () => {
    const pref = makePreference({
      key: "style:verbose",
      value: "likes detailed verbose responses",
      strength: 0.8,
    });
    const model = makeUserModel(new Map([["style:verbose", pref]]));

    // prompt has "quick" which matches no keywords from pref.value or pref.key
    // prefKeywords = detailed(8), verbose(7), responses(9)
    // prefKey = style(5), verbose(7)  (split by :/)
    // allKeywords = {detailed, verbose, responses, style}
    // prompt: "give a quick answer" -> matchCount=0 < 1 -> skipped at matchCount check
    // Wait: matchCount < 1 -> continue. So it would be skipped.
    const results = findPreferenceReminders("give a quick answer", model);
    expect(results).toEqual([]);
  });

  it("requires matchCount >= 1 for first check, then needs conflict OR matchCount >= 2", () => {
    const pref = makePreference({
      key: "style:verbose",
      value: "likes detailed verbose responses",
      strength: 0.8,
    });
    const model = makeUserModel(new Map([["style:verbose", pref]]));

    // prompt has "verbose" -> matchCount=1 -> passes first check
    // not a conflict, and matchCount=1 < 2 -> second check fails
    const results = findPreferenceReminders("give a verbose answer", model);
    expect(results).toEqual([]);
  });

  it("surfaces reminder with 2+ keyword matches and no conflict", () => {
    const pref = makePreference({
      key: "style:verbose",
      value: "likes detailed verbose responses",
      strength: 0.8,
    });
    const model = makeUserModel(new Map([["style:verbose", pref]]));

    // prompt has "detailed verbose response" -> matchCount=3
    const results = findPreferenceReminders("give me a detailed verbose response", model);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("reminder");
  });

  it("limits evidence to first 3 sources", () => {
    const pref = makePreference({
      key: "language:typescript",
      value: "prefers TypeScript language",
      strength: 0.8,
      sources: ["s1", "s2", "s3", "s4", "s5"],
    });
    const model = makeUserModel(new Map([["language:typescript", pref]]));

    // "prefers typescript language" → matchCount=3 >= 2, no conflict
    const results = findPreferenceReminders("prefers typescript language", model);
    expect(results[0].evidence).toEqual(["s1", "s2", "s3"]);
  });

  it("handles multiple preferences with different match states", () => {
    const pref1 = makePreference({ key: "lang:typescript", value: "prefers TypeScript", strength: 0.9 });
    const pref2 = makePreference({ key: "style:brief", value: "likes brief", strength: 0.3 }); // below threshold
    const pref3 = makePreference({ key: "lang:python", value: "prefers Python coding", strength: 0.7 });
    const model = makeUserModel(new Map([
      ["lang:typescript", pref1],
      ["style:brief", pref2],
      ["lang:python", pref3],
    ]));

    // pref1: "prefers typescript" matches (2 keywords) -> reminder (no conflict)
    // pref2: strength 0.3 -> skipped
    // pref3: "python" and "coding" don't appear in prompt -> skipped
    const results = findPreferenceReminders("prefers typescript everywhere", model);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("preference");
  });
});

// ============================================================================
// formatWarningContext
// ============================================================================

describe("formatWarningContext", () => {
  it("returns empty context when suggestions array is empty", () => {
    const result = formatWarningContext([]);
    expect(result).toEqual({ suggestions: [], formatted: "" });
  });

  it("sorts by priority (high first) then by score descending", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "Low score low priority", priority: "low", score: 0.9 }),
      makeSuggestion({ text: "High priority", priority: "high", score: 0.5 }),
      makeSuggestion({ text: "Medium priority higher score", priority: "medium", score: 0.8 }),
      makeSuggestion({ text: "Medium priority lower score", priority: "medium", score: 0.3 }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.suggestions).toHaveLength(3); // top 3
    expect(result.suggestions[0].text).toBe("High priority");
    expect(result.suggestions[1].text).toBe("Medium priority higher score");
    expect(result.suggestions[2].text).toBe("Medium priority lower score");
  });

  it("limits output to top 3 suggestions", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "S1", priority: "high", score: 0.9 }),
      makeSuggestion({ text: "S2", priority: "high", score: 0.8 }),
      makeSuggestion({ text: "S3", priority: "high", score: 0.7 }),
      makeSuggestion({ text: "S4", priority: "high", score: 0.6 }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions.map(s => s.text)).toEqual(["S1", "S2", "S3"]);
  });

  it("formats output string with correct icons for each type", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "Warning text", type: "warning" }),
      makeSuggestion({ text: "Prediction text", type: "prediction" }),
      makeSuggestion({ text: "Reminder text", type: "reminder" }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.formatted).toContain("[!] Warning text");
    expect(result.formatted).toContain("[~] Prediction text");
    expect(result.formatted).toContain("[i] Reminder text");
    expect(result.formatted).toContain("--- Proactive Warnings ---");
  });

  it("uses [+] icon for recommendation type", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "Recommend text", type: "recommendation" }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.formatted).toContain("[+] Recommend text");
  });

  it("preserves the sorted slice in the suggestions array", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "A", priority: "low", score: 0.9 }),
      makeSuggestion({ text: "B", priority: "high", score: 0.5 }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].text).toBe("B");
    expect(result.suggestions[1].text).toBe("A");
  });

  it("does not mutate the original array", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "First", priority: "low" }),
      makeSuggestion({ text: "Second", priority: "high" }),
    ];

    const originalOrder = suggestions.map(s => s.text);
    formatWarningContext(suggestions);
    expect(suggestions.map(s => s.text)).toEqual(originalOrder);
  });

  it("handles exactly 3 suggestions", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "A", priority: "high" }),
      makeSuggestion({ text: "B", priority: "medium" }),
      makeSuggestion({ text: "C", priority: "low" }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions.map(s => s.text)).toEqual(["A", "B", "C"]);
  });

  it("formatted string joins lines with newlines", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "First", priority: "high" }),
      makeSuggestion({ text: "Second", priority: "medium" }),
    ];

    const result = formatWarningContext(suggestions);
    const parts = result.formatted.split("\n");
    expect(parts).toHaveLength(3); // header + 2 items
    expect(parts[0]).toBe("--- Proactive Warnings ---");
  });

  it("tie-breaks same priority by score descending", () => {
    const suggestions: ProactiveSuggestion[] = [
      makeSuggestion({ text: "Lower score", priority: "high", score: 0.6 }),
      makeSuggestion({ text: "Higher score", priority: "high", score: 0.9 }),
    ];

    const result = formatWarningContext(suggestions);
    expect(result.suggestions[0].text).toBe("Higher score");
    expect(result.suggestions[1].text).toBe("Lower score");
  });
});

// ============================================================================
// computeRecencyWeight (tested indirectly via exported functions)
// ============================================================================

describe("recency weight behaviour (indirect via findWarningLessons)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: "" } },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 1.0 for items within 1 day", async () => {
    // Override fetch for this test
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: new Date().toISOString() } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 1.0, 5);
  });

  it("returns 0.9 for items between 1 and 7 days old", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: threeDaysAgo } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.9, 5);
  });

  it("returns 0.75 for items between 7 and 30 days old", async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: twentyDaysAgo } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.75, 5);
  });

  it("returns 0.6 for items between 30 and 90 days old", async () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: sixtyDaysAgo } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.6, 5);
  });

  it("returns 0.5 for items older than 90 days", async () => {
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: hundredDaysAgo } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.5, 5);
  });

  it("returns 0.7 for undefined created_at", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" } } }, // no created_at
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.7, 5);
  });

  it("returns 0.7 for invalid date string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: "not-a-date" } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.7, 5);
  });

  it("returns 0.7 for future date (ageMs < 0)", async () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: [
          { id: "l", score: 0.8, payload: { text: "T", metadata: { lesson_type: "gotcha" }, created_at: futureDate } },
        ],
      }),
    }));
    const results = await findWarningLessons("http://qdrant:6333", [0.1], 0.5);
    expect(results[0].score).toBeCloseTo(0.8 * 0.7, 5);
  });
});
