/**
 * Mnemosyne — Benchmarks
 *
 * Measures core operation latencies: BM25 index/search, classification,
 * dedup, sentiment analysis, decay computation, confidence scoring.
 * These are unit-level benchmarks that don't require external infrastructure.
 *
 * Run: npx tsx bench.ts
 */
import { BM25Index } from "./src/core/bm25.js";
import { classifyMemoryType, classifyUrgency, classifyDomain } from "./src/pipeline/classifier.js";
import { analyzeSentiment, newFrustrationState, updateFrustration } from "./src/cognitive/sentiment.js";
import { computeActivation, getDecayStatus } from "./src/cognitive/decay.js";
import { computeConfidence } from "./src/cognitive/confidence.js";
import { isDuplicate, detectConflict, shouldSemanticMerge } from "./src/core/dedup.js";
import type { MemCell, MemCellSearchResult } from "./src/core/types.js";

function makeDummyCell(id: string): MemCell {
  return {
    id,
    text: "dummy",
    memoryType: "semantic",
    classification: "public",
    agentId: "bench",
    scope: "public",
    urgency: "reference",
    domain: "knowledge",
    confidence: 0.7,
    confidenceTag: "grounded",
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
  };
}

function makeDummySearchResult(id: string, score: number): MemCellSearchResult {
  return { entry: makeDummyCell(id), score };
}

function bench(label: string, fn: () => void | Promise<void>, iterations = 10000): void {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const total = (performance.now() - start).toFixed(2);
  const perOp = (parseFloat(total) / iterations).toFixed(3);
  console.log(`  ${label.padEnd(50)} ${total.padStart(8)}ms total  ${perOp.padStart(6)}ms/op  (×${iterations})`);
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Mnemosyne — Benchmarks (unit-level, no infra needed)");
  console.log("══════════════════════════════════════════════════════\n");

  // BM25 Index
  console.log("┌─ BM25 Index ──────────────────────────────────────────┐");
  {
    const index = new BM25Index();
    for (let i = 0; i < 1000; i++) {
      index.addDocument(`doc-${i}`, `document number ${i} about servers and databases for configuration management`);
    }
    bench("BM25Index.search (1000 docs)", () => index.search("server configuration", 10), 1000);
    bench("BM25Index.addDocument", () => index.addDocument("new-doc", "a new document about testing"), 1000);
    bench("BM25Index.removeDocument", () => index.removeDocument("doc-0"), 1000);
    bench("BM25Index.stats", () => index.stats(), 5000);
  }

  // Classification
  console.log("\n┌─ Classifier ──────────────────────────────────────────┐");
  {
    bench("classifyMemoryType('how to deploy')", () => classifyMemoryType("how to deploy the server"), 10000);
    bench("classifyMemoryType('I prefer dark')", () => classifyMemoryType("I prefer dark mode"), 10000);
    bench("classifyUrgency('server down!')", () => classifyUrgency("the server is down and crashing"), 10000);
    bench("classifyDomain('docker deploy')", () => classifyDomain("deploy the docker container"), 10000);
    bench("classifyMemoryType (mixed)", () => {
      classifyMemoryType("yesterday we discussed the API deployment");
      classifyMemoryType("this is a general fact");
      classifyMemoryType("step 1: install");
    }, 5000);
  }

  // Dedup
  console.log("\n┌─ Dedup ───────────────────────────────────────────────┐");
  {
    bench("isDuplicate(0.95)", () => isDuplicate(0.95), 50000);
    bench("isDuplicate(0.90)", () => isDuplicate(0.90), 50000);
    const result = makeDummySearchResult("existing", 0.95);
    bench("shouldSemanticMerge (merge)", () => shouldSemanticMerge(result, "new text", "semantic"), 10000);
    bench("detectConflict", () => detectConflict("the server is running", "the server is not running", 0.80), 10000);
  }

  // Sentiment
  console.log("\n┌─ Sentiment ───────────────────────────────────────────┐");
  {
    bench("analyzeSentiment (positive)", () => analyzeSentiment("thank you that is great"), 10000);
    bench("analyzeSentiment (negative)", () => analyzeSentiment("this is wrong and broken"), 10000);
    bench("analyzeSentiment (neutral)", () => analyzeSentiment("the server IP is 192.168.1.1"), 10000);
    bench("analyzeSentiment (frustrated)", () => analyzeSentiment("I already told you this is the same error"), 10000);
    bench("updateFrustration (positive)", () => {
      const state = newFrustrationState();
      updateFrustration(state, analyzeSentiment("thanks that works"));
    }, 10000);
    bench("updateFrustration (escalating)", () => {
      let state = newFrustrationState();
      for (let i = 0; i < 5; i++) {
        const signal = analyzeSentiment("this is wrong and broken");
        state = updateFrustration(state, signal);
      }
    }, 5000);
  }

  // Decay
  console.log("\n┌─ Decay ───────────────────────────────────────────────┐");
  {
    const now = Date.now();
    const recentAccess = [now - 3600000]; // 1 hour ago
    const oldAccess = [now - 86400000 * 30]; // 30 days ago

    bench("computeActivation (recent, critical)", () => computeActivation(recentAccess, "critical", "semantic"), 10000);
    bench("computeActivation (old, background)", () => computeActivation(oldAccess, "background", "semantic"), 10000);
    bench("computeActivation (core, immune)", () => computeActivation(oldAccess, "background", "core"), 10000);
    bench("computeActivation + getDecayStatus", () => {
      const a = computeActivation(recentAccess, "important", "semantic");
      getDecayStatus(a);
    }, 10000);
  }

  // Confidence
  console.log("\n┌─ Confidence ──────────────────────────────────────────┐");
  {
    bench("computeConfidence (high)", () => computeConfidence(0.9, 0.9, 0.9), 10000);
    bench("computeConfidence (low)", () => computeConfidence(0.3, 0.3, 0.3), 10000);
    bench("computeConfidence (mixed)", () => computeConfidence(0.7, 0.5, 0.3), 10000);
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Benchmarks complete.");
  console.log("  Note: actual latencies with Qdrant/embeddings will be");
  console.log("  dominated by network I/O. These are pure CPU numbers.");
  console.log("══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
