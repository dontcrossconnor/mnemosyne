/**
 * Mnemosyne stdio JSON-RPC bridge for Hermes plugin.
 *
 * Protocol:
 *   → {"id":1,"cmd":"store","args":{"text":"...","opts":{}}}
 *   ← {"id":1,"ok":true,"result":{...}}
 *   → {"id":2,"cmd":"recall","args":{"query":"...","opts":{}}}
 *   ← {"id":2,"ok":true,"result":[...]}
 *   → {"id":3,"cmd":"exit"}
 *   ← (process exits)
 */

import { createMnemosyne, type Mnemosyne } from "./index.js";
import { QdrantDB } from "./core/qdrant.js";
import { DEFAULT_COLLECTIONS } from "./core/types.js";
import { createInterface } from "node:readline";

const QDRANT_URL = process.argv[2] || "http://localhost:6333";
const EMBEDDING_URL = process.argv[3] || "http://localhost:11434/v1/embeddings";
const AGENT_ID = process.argv[4] || "hermes";
const MODEL = process.argv[5] || "mxbai-embed-large";
const COLLECTION_PREFIX = process.argv[6] || "";

let memory: Mnemosyne | null = null;
let ready = false;
let qdrantDb: QdrantDB | null = null;

async function main() {
  const collections = COLLECTION_PREFIX
    ? {
        shared: `${COLLECTION_PREFIX}_shared`,
        private: `${COLLECTION_PREFIX}_private`,
      }
    : undefined;

  memory = await createMnemosyne({
    qdrantUrl: QDRANT_URL,
    embeddingUrl: EMBEDDING_URL,
    agentId: AGENT_ID,
    embeddingModel: MODEL,
    enableDecay: true,
    enableBM25: true,
    enableAutoLink: true,
    collections,
  });
  qdrantDb = new QdrantDB(QDRANT_URL, AGENT_ID, collections);
  ready = true;

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: { id?: number; cmd: string; args?: Record<string, unknown> };
    try {
      req = JSON.parse(trimmed);
    } catch {
      writeErr("invalid JSON");
      continue;
    }

    if (req.cmd === "exit") {
      process.exit(0);
    }

    try {
      await handle(req);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeRes(req.id, false, null, msg);
    }
  }
}

async function handle(req: { id?: number; cmd: string; args?: Record<string, unknown> }) {
  if (!memory) {
    writeRes(req.id, false, null, "not initialized");
    return;
  }

  switch (req.cmd) {
    case "ping": {
      writeRes(req.id, true, { ready });
      break;
    }
    case "store": {
      const args = req.args || {};
      const text = args.text as string;
      if (!text) { writeRes(req.id, false, null, "text required"); return; }
      const opts = (args.opts as Record<string, unknown>) || {};
      const result = await memory.store(text, opts);
      writeRes(req.id, true, { id: result });
      break;
    }
    case "recall": {
      const args = req.args || {};
      const query = args.query as string;
      if (!query) { writeRes(req.id, false, null, "query required"); return; }
      const opts = (args.opts as Record<string, unknown>) || {};
      const limit = (opts.limit as number) || 5;
      const minScore = (opts.minScore as number) || 0.3;
      const results = await memory.recall(query, { limit, minScore });
      writeRes(req.id, true, results.map(serializeResult));
      break;
    }
    case "forget": {
      const args = req.args || {};
      const id = args.id as string;
      const query = args.query as string;
      const result = await memory.forget(id || query || "");
      writeRes(req.id, true, { deleted: result });
      break;
    }
    case "toma": {
      // Theory of Mind: query what a SPECIFIC agent knows about a topic
      const args = req.args || {};
      const targetAgent = args.agent_id as string;
      const topic = args.topic as string;
      const limit = (args.limit as number) || 5;
      if (!targetAgent || !topic) {
        writeRes(req.id, false, null, "agent_id and topic required");
        return;
      }
      const sharedColl = COLLECTION_PREFIX
        ? `${COLLECTION_PREFIX}_shared`
        : DEFAULT_COLLECTIONS.SHARED;

      if (!qdrantDb) {
        writeRes(req.id, false, null, "qdrant not initialized");
        return;
      }

      // Embed the query
      const { EmbeddingsClient } = await import("./core/embeddings.js");
      const embedder = new EmbeddingsClient(EMBEDDING_URL, MODEL);
      const vector = await embedder.embed(topic);

      // Search shared collection filtered by agent_id
      const results = await qdrantDb.search(sharedColl, vector, limit, 0.3, {
        agent_id: targetAgent,
      });
      writeRes(req.id, true, results.map(serializeResult));
      break;
    }
    case "profile": {
      // Get agent memory profile: count, top domains, top types
      const args = req.args || {};
      const targetAgent = (args.agent_id as string) || AGENT_ID;
      const sharedColl = COLLECTION_PREFIX
        ? `${COLLECTION_PREFIX}_shared`
        : DEFAULT_COLLECTIONS.SHARED;

      if (!qdrantDb) {
        writeRes(req.id, false, null, "qdrant not initialized");
        return;
      }

      // Count memories for this agent
      const count = await qdrantDb.count(sharedColl);  // Total in collection
      writeRes(req.id, true, {
        agent_id: targetAgent,
        total_memories: count,
      });
      break;
    }
    default: {
      writeRes(req.id, false, null, `unknown cmd: ${req.cmd}`);
    }
  }
}

function serializeResult(r: { entry: { id: string; text: string; memoryType: string; urgency: string; domain: string; confidence: number; importance: number; agentId: string }; score: number }) {
  return {
    id: r.entry.id,
    text: r.entry.text,
    score: r.score,
    memoryType: r.entry.memoryType,
    urgency: r.entry.urgency,
    domain: r.entry.domain,
    confidence: r.entry.confidence,
    importance: r.entry.importance,
    agentId: r.entry.agentId,
  };
}

function writeRes(id: number | undefined, ok: boolean, result: unknown, error?: string) {
  const msg = { id: id ?? 0, ok, result, error: error || null };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function writeErr(msg: string) {
  process.stderr.write(`[bridge] ${msg}\n`);
}

main().catch((err) => {
  writeErr(String(err));
  process.exit(1);
});
