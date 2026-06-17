<p align="center">
  <h1 align="center">MNEMOSYNE</h1>
  <p align="center"><strong>Cognitive Memory OS for Autonomous AI Agents</strong></p>
  <p align="center">
    Persistent Memory &bull; Multi-Signal Retrieval &bull; Self-Improving Intelligence
  </p>
</p>

> **Original author:** [28naem-del](https://github.com/28naem-del) / Claude Opus 4.6 · **Refactoring & fixes:** Strix (2026-06-17)  
> See [STATUS.md](./STATUS.md) for the full bug log, test coverage, and benchmark results.

---

## What is Mnemosyne?

**Mnemosyne** is a production-grade cognitive memory system that gives AI agents persistent, searchable, self-improving long-term memory. It goes far beyond simple vector storage — Mnemosyne implements a full cognitive pipeline inspired by how human memory actually works: memories are classified, linked, decayed, consolidated, and reinforced through use.

### The Problem

AI agents today are stateless. Every conversation starts from zero. They can't learn from past interactions, can't build knowledge over time, and can't share what they've learned with other agents. This makes them fundamentally limited — unable to develop expertise, personalize responses, or operate as part of an intelligent system.

### The Solution

Mnemosyne provides a **5-layer cognitive memory architecture** that transforms any AI agent into a learning system:

- **Memories persist** across sessions with rich metadata, temporal awareness, and automatic classification
- **Retrieval is intelligent** — multi-signal scoring adapts to query intent, not just vector similarity
- **Knowledge grows** through automatic linking, graph traversal, and cross-agent corroboration
- **Quality improves** via reinforcement signals, contradiction detection, and active consolidation
- **Agents collaborate** through shared memory blocks, real-time broadcast, and fleet-wide synthesis

Mnemosyne is currently running in production managing **13,000+** memories across a 10-node agent mesh with sub-200ms retrieval latency.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         MNEMOSYNE COGNITIVE OS                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  L5: SELF-IMPROVEMENT LAYER                                     │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ │ │
│  │  │ Reinforcement│ │  Active      │ │   Flash    │ │  Agent   │ │ │
│  │  │   Learning   │ │Consolidation │ │ Reasoning  │ │Awareness │ │ │
│  │  │  (feedback)  │ │  (cleanup)   │ │  (chains)  │ │  (ToMA)  │ │ │
│  │  └──────────────┘ └──────────────┘ └────────────┘ └──────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  L4: COGNITIVE LAYER                                            │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ │ │
│  │  │  Activation  │ │  Confidence  │ │  Priority  │ │Diversity │ │ │
│  │  │    Decay     │ │    Tags      │ │  Scoring   │ │Reranking │ │ │
│  │  └──────────────┘ └──────────────┘ └────────────┘ └──────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  L3: KNOWLEDGE GRAPH LAYER                                      │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ │ │
│  │  │   Temporal   │ │    Auto      │ │    Path    │ │  Entity  │ │ │
│  │  │    Graph     │ │   Linking    │ │  Traversal │ │Extraction│ │ │
│  │  └──────────────┘ └──────────────┘ └────────────┘ └──────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  L2: PIPELINE LAYER                                             │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ │ │
│  │  │  Extraction  │ │    Type      │ │   Dedup    │ │ Security │ │ │
│  │  │   Pipeline   │ │ Classifier   │ │  & Merge   │ │  Filter  │ │ │
│  │  └──────────────┘ └──────────────┘ └────────────┘ └──────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  L1: INFRASTRUCTURE LAYER                                       │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │ │
│  │  │  Vector  │ │  Graph   │ │   Cache  │ │  Pub/Sub │           │ │
│  │  │   DB     │ │    DB    │ │  (2-tier)│ │Broadcast │           │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Store Path

```
User Input
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Security    │───▶│  Embedding   │───▶│   Dedup     │
│  Filter      │    │  Generation  │    │  & Merge    │
└─────────────┘    └──────────────┘    └─────────────┘
                                             │
                   ┌─────────────────────────┤
                   ▼                         ▼
          ┌──────────────┐          ┌──────────────┐
          │  Extraction  │          │   Conflict   │
          │  Pipeline    │          │  Detection   │
          └──────────────┘          └──────────────┘
                   │
    ┌──────────────┼──────────────┬──────────────┐
    ▼              ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Priority│  │Confidence│  │  Auto    │  │  Graph   │
│Scoring │  │  Rating  │  │  Link   │  │ Ingest   │
└────────┘  └──────────┘  └──────────┘  └──────────┘
    │              │              │              │
    └──────────────┴──────────────┴──────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       ┌──────────┐          ┌──────────┐
       │  Vector  │          │ Broadcast│
       │  Store   │          │  Publish │
       └──────────┘          └──────────┘
```

### Data Flow: Recall Path

```
Query
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│   Cache      │───▶│  Embedding   │───▶│   Vector     │
│   Lookup     │    │  Generation  │    │   Search     │
│ (L1 → L2)   │    └──────────────┘    └──────────────┘
└─────────────┘                              │
                                             ▼
                                    ┌──────────────┐
                                    │Intent-Aware  │
                                    │Multi-Signal  │
                                    │  Scoring     │
                                    └──────────────┘
                                             │
                              ┌──────────────┤
                              ▼              ▼
                     ┌──────────────┐ ┌──────────────┐
                     │  Diversity   │ │    Graph     │
                     │  Reranking   │ │ Enrichment   │
                     └──────────────┘ └──────────────┘
                              │              │
                              └──────┬───────┘
                                     ▼
                            ┌──────────────┐
                            │    Flash     │
                            │  Reasoning   │
                            │   Chains     │
                            └──────────────┘
                                     │
                                     ▼
                               Final Results
```

---

## Layer-by-Layer Architecture

### L1: Infrastructure Layer

The foundation layer provides persistent storage, caching, and real-time communication.

| Component | Role | Backend |
|-----------|------|---------|
| **Vector Store** | Primary memory storage with 768-dimensional embeddings | Qdrant |
| **Graph Database** | Temporal knowledge graph for entity relationships | FalkorDB (RedisGraph-compatible) |
| **2-Tier Cache** | L1 in-memory (50 entries, 5min TTL) + L2 distributed (1hr TTL) | In-process + Redis |
| **Pub/Sub Broadcast** | Real-time memory events across agent mesh | Redis Pub/Sub |
| **Embedding Service** | Text-to-vector conversion (768-dim, Nomic architecture) | Any OpenAI-compatible endpoint |

**Key design decisions:**
- Bi-temporal data model: every memory tracks both `eventTime` (when it happened) and `ingestedAt` (when stored)
- Soft-delete architecture: memories are never physically deleted, enabling audit trails and recovery
- Collection isolation: shared memories, private memories, agent profiles, and procedural skills each get dedicated vector collections

### L2: Pipeline Layer

The ingestion pipeline transforms raw text into structured, classified, enrichable memories through a deterministic 12-step process.

#### Step-by-Step Pipeline

| Step | Component | What It Does |
|------|-----------|-------------|
| 1 | **Security Filter** | 3-tier classification (public/private/secret). Blocks secrets (API keys, credentials, private keys) from ever being stored. Private memories are agent-scoped. |
| 2 | **Embedding Generation** | Converts text to 768-dimensional vector with LRU caching (512 entries). |
| 3 | **Deduplication & Merge** | Cosine similarity check: ≥0.92 = duplicate (merge or reject), 0.70-0.92 = potential conflict (broadcast alert). Smart semantic merge preserves the higher-quality version. |
| 4 | **Extraction Pipeline** | Extracts structured metadata: memory type, entities (names, IPs, dates, technologies, URLs), domain classification. Runs locally with zero LLM calls. |
| 5 | **Urgency Classification** | 4-level urgency: critical, important, reference, background. Keyword-driven, no LLM required. |
| 6 | **Domain Classification** | 5 domains: technical, personal, project, knowledge, general. Determines retrieval weighting. |
| 7 | **Priority Scoring** | 0.0-1.0 composite score from urgency × domain. Critical+technical = 1.0, background+general = 0.2. |
| 8 | **Confidence Rating** | Multi-signal confidence: retrieval score × source trust × cross-agent agreement. 4 tiers: Mesh Fact, Grounded, Inferred, Uncertain. |
| 9 | **Vector Storage** | Written to appropriate collection with full metadata payload (23 fields per memory). |
| 10 | **Auto-Linking** | Bidirectional links to related memories (similarity > 0.70). Creates a Zettelkasten-style knowledge web. |
| 11 | **Graph Ingestion** | Entities and relationships added to temporal knowledge graph with Memory → Entity → Entity traversal paths. |
| 12 | **Broadcast** | Published to mesh via typed channels. Critical memories get priority routing. Cache invalidated. |

**Zero-LLM design:** The entire pipeline runs without any LLM calls. Classification, entity extraction, urgency detection, and conflict resolution are all algorithmic — delivering consistent sub-50ms ingestion latency.

### L3: Knowledge Graph Layer

A temporal knowledge graph that captures entity relationships and enables multi-hop reasoning.

| Feature | Description |
|---------|-------------|
| **Temporal Queries** | "What was X connected to as of date Y?" — relationships carry `since` timestamps |
| **Auto-Linking** | New memories automatically discover and link to related existing memories (bidirectional) |
| **Path Finding** | Shortest-path queries between any two entities (configurable max depth) |
| **Timeline Reconstruction** | Ordered history of all memories mentioning a given entity |
| **Entity Extraction** | Automatic identification of people, machines, technologies, IP addresses, dates, ports, URLs |
| **Depth-Limited Traversal** | Configurable graph exploration depth (default: 2 hops) to balance relevance vs. noise |

**Graph schema:**
```
(Memory) ──MENTIONS──▶ (Entity)
(Memory) ──CREATED_BY──▶ (Agent)
(Entity) ──RELATES_TO──▶ (Entity)
```

### L4: Cognitive Layer

The intelligence layer that makes retrieval context-aware, temporally-sensitive, and diversity-optimized.

#### Activation Decay

Memories have activation levels that decay over time following a logarithmic model. Each access refreshes activation. Configurable decay rates by urgency:

| Urgency | Decay Rate | Baseline | Effect |
|---------|-----------|----------|--------|
| Critical | 0.3 (slow) | +2.0 | Stays active for months |
| Important | 0.5 | +1.0 | Active for weeks |
| Reference | 0.6 | 0.0 | Fades over days |
| Background | 0.8 (fast) | -1.0 | Fades within hours |

Core memories and procedural skills are **immune to decay** — they remain permanently active.

Activation states: **Active** (≥ -2.0) → **Fading** (-2.0 to -4.0) → **Archived** (< -4.0, excluded from search).

#### Multi-Signal Scoring

Every search result is scored across 5 independent signals, weighted by detected query intent:

| Signal | What It Measures |
|--------|-----------------|
| **Semantic Similarity** | Vector distance between query and memory |
| **Temporal Recency** | How recently the memory was created or accessed |
| **Importance × Confidence** | Priority score multiplied by confidence rating |
| **Access Frequency** | How often this memory has been recalled (logarithmic) |
| **Type Relevance** | How well the memory type matches the inferred query intent |

**Intent-adaptive weighting:**

| Intent | Primary Signal | Weight |
|--------|---------------|--------|
| Factual | Similarity | 50% |
| Temporal | Recency | 35% |
| Procedural | Frequency | 20% boost |
| Preference | Type Relevance | 20% boost |
| Exploratory | Balanced | Even distribution |

Intent is detected automatically from query patterns — no user configuration needed.

#### Diversity Reranking

Search results are post-processed to maximize information diversity:

- **Cluster detection:** Results with >0.9 cosine similarity are grouped; only the highest-scoring member passes through, others receive a -40% penalty
- **Overlap penalty:** Results >0.8 similar to already-selected results receive -15%
- **Type diversity:** Same memory type appearing 3+ times triggers -5% per additional duplicate

This ensures that a query about "deployment" returns a mix of procedures, decisions, errors, and facts — not five slightly different versions of the same deployment guide.

### L5: Self-Improvement Layer

The highest layer enables the memory system to learn and improve from its own operation.

#### Reinforcement Learning

A feedback loop that tracks which memories actually proved useful:

- After each recall+response cycle, the system detects positive/negative signals from user behavior
- Positive signals: explicit thanks, "that's right", referencing recalled content
- Negative signals: "that's wrong", corrections, ignoring recalled memories
- Tracked metrics per memory: `hit_count`, `useful_count`, `usefulness_ratio`
- **Promotion rule:** Memories with usefulness ratio >0.7 after 3+ retrievals are promoted to core memory type
- **Review flag:** Memories with consistently negative feedback are flagged for manual review

#### Active Consolidation

Four-phase maintenance that runs on-demand or on schedule:

| Phase | What It Does | Trigger |
|-------|-------------|---------|
| **Contradiction Detection** | Finds memory pairs with high similarity but negation mismatch | Cosine 0.70-0.92 + semantic conflict |
| **Near-Duplicate Merge** | Combines memories with >0.92 similarity | Keeps higher access count, merges metadata |
| **Popular Promotion** | Promotes frequently-accessed memories (>10 accesses) to core type | Access count threshold |
| **Stale Demotion** | Reduces priority of idle, low-importance memories | 30+ days idle, importance < 0.3 |

#### Flash Reasoning

Chain-of-thought traversal through linked memories:

- BFS traversal follows `linkedMemories` connections up to configurable depth
- Infers relationship types: `leads_to`, `because`, `therefore`, `related_to`
- Enriches search results with reasoning context: `"deployed service → because → config changed → therefore → restart needed"`
- Cycle detection prevents infinite traversal

#### Agent Awareness Engine

Multi-agent knowledge modeling (Theory of Mind for Agents):

| Capability | Description |
|-----------|-------------|
| **Agent Knowledge Query** | "What does Agent-B know about topic X?" — filtered vector search by agent ID |
| **Knowledge Gap Analysis** | Compare two agents' knowledge on a topic — surface what one knows that the other doesn't |
| **Agent Profiles** | Aggregated view: total memories, top domains, top types, avg confidence, last active time |
| **Cross-Agent Synthesis** | When 3+ agents agree on a fact, it's synthesized into a fleet-level insight |
| **Auto-Detection** | Queries mentioning agent names are automatically routed through the awareness engine |

---

## Memory Type System

Mnemosyne uses a 7-type taxonomy for memory classification:

| Type | Description | Decay Behavior |
|------|-------------|---------------|
| `episodic` | Specific events and experiences | Normal decay |
| `semantic` | General knowledge and facts | Normal decay |
| `preference` | User/agent preferences and styles | Normal decay |
| `relationship` | Connections between entities | Normal decay |
| `procedural` | Step-by-step procedures and skills | **Immune** to decay |
| `profile` | Agent/entity profile summaries | Normal decay |
| `core` | Verified, high-value foundational memories | **Immune** to decay |

Classification is fully algorithmic — no LLM required. Pattern matching detects procedural language ("step 1", "how to"), preferences ("prefer", "always use"), relationships ("works with", "reports to"), etc.

---

## Confidence System

Every memory carries a confidence score and human-readable confidence tag:

| Tag | Score Range | Meaning |
|-----|-----------|---------|
| **Mesh Fact** | ≥ 0.85 | Corroborated by multiple agents or sources |
| **Grounded** | 0.65 - 0.84 | Strong single-source evidence |
| **Inferred** | 0.40 - 0.64 | Reasonable inference, not directly verified |
| **Uncertain** | < 0.40 | Low confidence, may need verification |

Confidence is computed from three signals:
- **Retrieval quality** (50%): How well the original information was extracted
- **Cross-agent agreement** (30%): Whether other agents have corroborating memories
- **Source trust** (20%): Configurable trust hierarchy for different agent/input sources

---

## Tools & API Reference

Mnemosyne exposes **9 tools** that integrate with any LLM agent framework:

### Core Memory Operations

#### `memory_recall`
**Intelligent memory search with multi-signal ranking.**

```
Parameters:
  query: string     — Natural language search query
  limit?: number    — Max results (default: 5)
  minScore?: number — Minimum relevance threshold (default: 0.3)

Returns: Ranked list of memories with scores, confidence tags, and decay status
```

Features:
- Intent-aware scoring adapts weights to query type (factual, temporal, procedural, preference, exploratory)
- Diversity reranking prevents redundant results
- Automatic graph enrichment appends related entities
- Flash reasoning chains provide context for linked memories
- Agent awareness auto-detection routes agent-specific queries
- Proactive recall surfaces related context the agent didn't explicitly ask for
- Two-tier cache (L1 in-memory, L2 distributed) for sub-10ms repeated lookups

#### `memory_store`
**Full 12-step ingestion pipeline.**

```
Parameters:
  text: string         — Content to memorize
  importance?: number  — 0.0-1.0 importance override
  category?: string    — Optional type hint
  eventTime?: string   — When the event occurred (ISO 8601)

Returns: { status: "created" | "duplicate" | "blocked_secret", linkedCount: number }
```

Features:
- Security filter blocks credentials and secrets
- Automatic deduplication with smart merge
- Conflict detection broadcasts alerts for contradictory information
- Auto-linking to related memories
- Graph ingestion with entity extraction
- Real-time broadcast to agent mesh

#### `memory_forget`
**Soft-delete by ID or semantic search.**

```
Parameters:
  memoryId?: string  — Direct ID reference (supports short IDs)
  query?: string     — Semantic search to find what to forget

Returns: Confirmation or candidate list for disambiguation
```

Features:
- Short ID resolution (first 8 characters map to full UUID)
- Auto-delete when exactly one high-confidence (>0.9) match found
- Returns candidates for user selection when ambiguous
- Broadcasts invalidation event to agent mesh

### Mesh Sync (Shared State)

#### `memory_block_get`
**Read a named shared memory block.**

```
Parameters:
  name: string  — Block name (e.g., "project_status", "team_roster")

Returns: { content, version, lastWriter, updatedAt }
```

#### `memory_block_set`
**Write/update a named shared memory block.**

```
Parameters:
  name: string     — Block name
  content: string  — Block content

Returns: { version, id }
```

Shared blocks provide a **Mesh Sync** mechanism — named, versioned key-value state that all agents in the mesh can read and write. Think of them as shared whiteboards: `"project_status"`, `"current_sprint"`, `"team_preferences"`. Blocks are stored as core memories with maximum confidence, ensuring they're always retrievable.

### Self-Improvement

#### `memory_feedback`
**Reinforcement learning signal for retrieved memories.**

```
Parameters:
  signal: "positive" | "negative"  — Was the recalled memory useful?
  memoryId?: string                — Specific memory (or applies to all last-recalled)

Returns: { updated: number, promoted: number }
```

Closes the feedback loop: agents report which memories helped and which didn't, enabling the system to promote valuable memories and flag poor ones.

#### `memory_consolidate`
**Run active consolidation pipeline.**

```
Parameters:
  batchSize?: number  — Memories per batch (default: 100)

Returns: ConsolidationReport {
  contradictions: number,
  nearDuplicatesMerged: number,
  popularPromoted: number,
  staleDemoted: number
}
```

Four-phase cleanup: contradiction detection, near-duplicate merge, popular promotion, stale demotion.

### Agent Awareness

#### `memory_toma`
**Query what a specific agent knows about a topic.**

```
Parameters:
  agentId: string   — Target agent identifier
  topic: string     — What to ask about
  limit?: number    — Max results

Returns: Formatted list of the agent's knowledge on that topic
```

Enables agents to model each other's knowledge — "What does the DevOps agent know about the production database?" — enabling better task routing and collaboration.

### Lifecycle Hooks

#### `before_agent_start` (automatic)
Fires before every agent invocation:
1. Recovers previous session context (if available)
2. Searches for memories relevant to the current prompt
3. Generates proactive queries to surface related context
4. Injects recovered + recalled memories as prepended context

#### `agent_end` (automatic)
Fires after every agent completion:
1. Saves session snapshot for compaction survival
2. Auto-captures up to 3 noteworthy memories from the conversation
3. Detects and applies feedback signals from user behavior

---

## CLI Reference

Mnemosyne includes a CLI for operations and maintenance:

| Command | Description |
|---------|-------------|
| `mnemosyne count` | Memory count across all collections |
| `mnemosyne search <query>` | Enhanced search with JSON output |
| `mnemosyne consolidate [--dry-run]` | Run standard consolidation |
| `mnemosyne consolidate-deep [--batch N]` | Run active consolidation (4 phases) |
| `mnemosyne bot-profile <agentId>` | Agent knowledge profile |
| `mnemosyne knowledge-gap <agentA> <agentB> <topic>` | Cross-agent knowledge gap analysis |
| `mnemosyne synthesize <topic>` | Fleet-level insight synthesis |
| `mnemosyne skills [query]` | List/search procedural memory library |

---

## Storage Architecture

### Collections

| Collection | Purpose | Scope |
|-----------|---------|-------|
| **Shared Memories** | All public memories accessible by every agent | Fleet-wide |
| **Private Memories** | Per-agent private memories + session snapshots | Agent-scoped |
| **Agent Profiles** | Cached agent knowledge summaries | Fleet-wide |
| **Skill Library** | Procedural memories (learned sequences) | Fleet-wide |

### Memory Cell Schema (23 fields)

```typescript
interface MemoryCell {
  // Identity
  id: string                    // UUID
  text: string                  // Memory content

  // Classification
  memoryType: MemoryType        // 7-type taxonomy
  classification: Classification // public | private | secret
  urgency: UrgencyLevel         // critical → background
  domain: Domain                // technical → general

  // Scoring
  importance: number            // 0.0 - 1.0
  priorityScore: number         // Computed from urgency × domain
  confidenceScore: number       // Multi-signal confidence
  confidenceTag: ConfidenceTag  // Human-readable tier

  // Temporal (bi-temporal model)
  eventTime: string             // When it happened
  ingestedAt: string            // When stored
  updatedAt: string             // Last modification

  // Provenance
  botId: string                 // Creating agent
  source: string                // Origin context

  // Connectivity
  linkedMemories: string[]      // Bidirectional links
  entities: string[]            // Extracted entities

  // Usage Tracking
  accessCount: number           // Total retrievals
  accessTimes: number[]         // Timestamp array for decay
  hitCount: number              // Feedback tracking
  usefulCount: number           // Positive feedback count

  // State
  deleted: boolean              // Soft-delete flag
  decayStatus: string           // active | fading | archive
}
```

---

## Performance Characteristics

| Metric | Value | Conditions |
|--------|-------|-----------|
| **Store latency** | < 50ms | Full 12-step pipeline (no LLM calls) |
| **Recall latency (cached)** | < 10ms | L1 cache hit |
| **Recall latency (uncached)** | < 200ms | Full multi-signal search + graph enrichment |
| **Embedding generation** | ~15ms | 768-dim with LRU cache (512 entries) |
| **Consolidation throughput** | ~1,000 memories/min | Batch size 100, 4-phase pipeline |
| **Memory capacity tested** | 13,000+ | Production workload, 10-agent mesh |
| **Concurrent agents** | 10+ | Real-time pub/sub, no locking required |

### Scalability Properties

- **Vector search:** Sub-linear scaling via HNSW index (Qdrant)
- **Cache hit rates:** >60% in typical conversational workloads (L1 + L2 combined)
- **Graph queries:** Depth-limited traversal with configurable bounds
- **Broadcast:** Redis pub/sub handles thousands of messages/second
- **Storage:** Qdrant supports billions of vectors; FalkorDB handles millions of nodes

---

## Deployment Models

### Single Node
```
┌─────────────────────────────────┐
│          Application            │
│    ┌───────────────────────┐    │
│    │      Mnemosyne        │    │
│    └───────┬───────────────┘    │
│            │                    │
│   ┌────────┼────────┐          │
│   │  Qdrant │ Redis  │          │
│   │  FalkorDB       │          │
│   └─────────────────┘          │
└─────────────────────────────────┘
```

All services on one machine. Suitable for development, testing, and single-agent deployments. Minimum requirements: 4GB RAM, 2 CPU cores.

### Multi-Node Mesh
```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Agent A  │  │ Agent B  │  │ Agent C  │
│Mnemosyne │  │Mnemosyne │  │Mnemosyne │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   │
        ┌──────────┴──────────┐
        │   Shared Services   │
        │  ┌──────┐ ┌──────┐  │
        │  │Qdrant│ │Redis │  │
        │  └──────┘ └──────┘  │
        │  ┌──────┐ ┌──────┐  │
        │  │Falkor│ │Embed │  │
        │  └──────┘ └──────┘  │
        └─────────────────────┘
```

Multiple agents share centralized infrastructure. Each agent runs its own Mnemosyne instance connecting to shared Qdrant, Redis, FalkorDB, and embedding service. Real-time sync via Redis pub/sub.

### Cloud / Managed
```
┌────────────────────────────┐
│     Cloud Infrastructure   │
│  ┌────────┐  ┌──────────┐  │
│  │Qdrant  │  │  Redis   │  │
│  │Cloud   │  │ Managed  │  │
│  └────────┘  └──────────┘  │
│  ┌────────┐  ┌──────────┐  │
│  │FalkorDB│  │ Embed    │  │
│  │Managed │  │  API     │  │
│  └────────┘  └──────────┘  │
└────────────────────────────┘
         ▲  ▲  ▲
         │  │  │
    Agent instances (serverless/containers)
```

All backing services hosted as managed cloud services. Mnemosyne connects via configuration — no code changes required. Compatible with Qdrant Cloud, Redis Cloud, any OpenAI-compatible embedding API.

---

## Configuration

Mnemosyne is configured through a single config object:

```typescript
interface MnemosyneConfig {
  // Infrastructure endpoints
  vectorDbUrl: string           // Qdrant endpoint
  embeddingUrl: string          // OpenAI-compatible embedding API
  graphDbUrl?: string           // FalkorDB/RedisGraph endpoint
  cacheUrl?: string             // Redis endpoint for L2 cache + pub/sub
  extractionUrl?: string        // Optional extraction service

  // Identity
  agentId: string               // This agent's identifier

  // Feature toggles
  autoCapture: boolean          // Auto-store from conversations (default: true)
  autoRecall: boolean           // Auto-recall before agent start (default: true)
  enableGraph: boolean          // Knowledge graph integration (default: true)
  enableAutoLink: boolean       // Automatic memory linking (default: true)
  enableDecay: boolean          // Activation decay model (default: true)
  enableBroadcast: boolean      // Cross-agent pub/sub (default: true)
  enablePriorityScoring: boolean // Urgency/domain scoring (default: true)
  enableConfidenceTags: boolean  // Confidence rating system (default: true)

  // Tuning
  autoLinkThreshold: number     // Min similarity for auto-link (default: 0.70)
  captureMaxChars: number       // Max chars per auto-capture (default: 500)
}
```

Every cognitive feature can be independently toggled, allowing gradual adoption from simple vector store to full cognitive OS.

---

## AGI-Grade Cognitive Features

The capabilities below represent the frontier of cognitive AI systems — techniques that exist almost exclusively in academic literature and closed research labs. Mnemosyne is the first system to implement all ten as production-ready, deployable infrastructure.

### Flash Reasoning
Chain-of-thought traversal through linked memory graphs. When a query triggers a memory, the system autonomously walks connected nodes — following causal, temporal, and semantic links — to reconstruct multi-step reasoning chains. The agent doesn't just recall a fact; it reconstructs the logic that produced it: `"service failed → because config changed → which happened after deploy → therefore rollback needed"`. Depth-limited BFS with cycle detection ensures bounded latency even on dense graphs.

### Agent Awareness Engine (Theory of Mind)
Agents maintain computational models of what other agents know. Any agent can query another's knowledge state — "What does the DevOps agent know about the production database?" — without direct communication. Knowledge gap analysis identifies asymmetries between agents, enabling intelligent task routing and collaborative problem-solving. When three or more agents independently corroborate a fact, it is automatically synthesized into a fleet-level insight with elevated confidence.

### Observational Memory
Raw conversational streams are compressed into structured observation patterns through automatic extraction. Instead of storing every utterance, the system identifies salient facts, decisions, and behavioral patterns, then consolidates them into compact, high-signal memory cells. This mimics how human working memory selectively encodes experiences into long-term storage — capturing what matters, discarding noise.

### Reinforcement Learning
Memories are not static records — they are living objects that improve through use. Every retrieval event generates a feedback signal (positive or negative) based on downstream agent behavior. Memories that consistently prove useful are promoted to core status with permanent retention. Memories that consistently mislead are flagged and deprioritized. Over time, the memory system self-optimizes its retrieval quality without any manual curation.

### Self-Improving Consolidation
A four-phase autonomous maintenance pipeline that runs continuously:
1. **Contradiction Detection** — identifies memory pairs that assert conflicting facts and surfaces them for resolution
2. **Near-Duplicate Merge** — combines semantically overlapping memories while preserving the highest-quality version
3. **Popular Promotion** — elevates frequently-accessed, high-usefulness memories to permanent core status
4. **Stale Demotion** — gracefully deprioritizes idle, low-importance memories to keep the active knowledge base sharp

No human intervention required. The system maintains its own cognitive hygiene.

### Mesh Sync
Cross-agent shared cognitive state through named, versioned memory blocks. Every agent in the mesh can read and write to shared state — project status, team preferences, active priorities — with real-time broadcast propagation. This is not simple key-value storage; blocks are stored as core memories with maximum confidence, ensuring they participate in retrieval, reasoning, and consolidation alongside organic memories.

### Temporal Knowledge Graph
A bi-temporal entity graph that tracks not just what is true now, but what was true at any point in time. Every relationship carries both an event timestamp (when it became true) and an ingestion timestamp (when the system learned about it). This enables temporal queries — "What was the database connected to as of last Tuesday?" — and timeline reconstruction for any entity in the system.

### Proactive Recall
The system anticipates what an agent needs before the agent asks. Before every agent invocation, Mnemosyne generates speculative queries based on the incoming prompt, retrieves contextually relevant memories, and injects them as pre-loaded context. The agent starts every conversation with the relevant history already available — eliminating the cold-start problem that plagues stateless systems.

### Procedural Memory / Skill Library
Learned multi-step procedures are stored as first-class memory objects in a dedicated collection. When the system detects procedural language — sequential steps, how-to patterns, operational runbooks — it automatically classifies and preserves these as skills. Procedural memories are immune to activation decay, ensuring that hard-won operational knowledge persists indefinitely and is retrievable by any agent in the mesh.

### Session Survival
Cognitive continuity across context window resets. When an agent's context is compacted or a session ends, Mnemosyne captures a structured snapshot of the active cognitive state — working memories, recent decisions, open threads. On the next invocation, this snapshot is recovered and injected, allowing the agent to resume with full awareness of prior context. The agent experiences no discontinuity, even across complete context resets.

### Research-Grade Capability Matrix

| Capability | Industry Status | Mnemosyne Status |
|---|---|---|
| Flash Reasoning (chain-of-thought graph traversal) | Research paper only | **Production-ready** |
| Theory of Mind for agents | Research paper only | **Production-ready** |
| Observational memory compression | Research paper only | **Production-ready** |
| Reinforcement learning on memory | Research paper only | **Production-ready** |
| Autonomous self-improving consolidation | Not implemented | **Production-ready** |
| Cross-agent shared cognitive state | Not implemented | **Production-ready** |
| Bi-temporal knowledge graph | Research paper only | **Production-ready** |
| Proactive anticipatory recall | Not implemented | **Production-ready** |
| Procedural memory / skill library | Not implemented | **Production-ready** |
| Session survival across context resets | Not implemented | **Production-ready** |

**Mnemosyne is the first system to combine all ten of these capabilities in a single, production-deployed architecture.** Each feature is independently validated and running at scale — not a roadmap item, not a proof of concept, not a demo. This is the cognitive foundation that autonomous agents have been missing.

---

## Competitive Advantages

### 1. Zero-LLM Pipeline
The entire ingestion pipeline — classification, entity extraction, urgency detection, conflict resolution — runs without any LLM calls. This delivers:
- **Deterministic behavior:** Same input always produces same classification
- **Sub-50ms latency:** No waiting for model inference during storage
- **Zero additional cost:** No per-memory API charges
- **Offline capability:** Works without internet after initial embedding

### 2. Cognitive, Not Just Vector
Most memory systems are glorified vector databases with a search API. Mnemosyne adds genuine cognitive capabilities:
- Activation decay models time-based relevance
- Multi-signal scoring goes beyond cosine similarity
- Diversity reranking prevents echo chambers
- Reinforcement learning improves retrieval quality over time
- Active consolidation maintains memory health autonomously

### 3. Multi-Agent Native
Built from the ground up for agent meshes:
- Real-time broadcast keeps all agents synchronized
- Shared blocks provide common ground state
- Agent Awareness Engine enables knowledge modeling across agents
- Cross-agent corroboration strengthens facts via agreement
- Fleet-level synthesis generates insights no single agent could produce

### 4. Production-Hardened
Running in production with 13,000+ memories across 10 agents:
- Session snapshot/recovery survives context window compaction
- Two-tier caching with automatic invalidation
- Graceful degradation when optional services are unavailable
- Soft-delete architecture for safety and auditability
- Legacy memory compatibility (handles schema evolution gracefully)

### 5. Modular Architecture
Every layer and feature is independently toggleable:
- Start with just vector storage
- Add knowledge graph when ready
- Enable cognitive features progressively
- Turn on multi-agent when scaling
- No all-or-nothing commitment

### 6. Self-Improving
The system actively gets better through use:
- Feedback signals promote useful memories and flag poor ones
- Consolidation merges duplicates, resolves contradictions, promotes popular content
- Access patterns inform decay rates and retrieval scoring
- Cross-agent agreement strengthens confidence over time

---

## Use Cases

### AI Coding Assistants
Mnemosyne enables coding agents to remember project context, deployment procedures, architectural decisions, and past debugging sessions across conversations. An agent that helped deploy a service last week can recall the exact steps, gotchas, and configurations without re-discovery.

### Enterprise Knowledge Agents
Deploy a mesh of specialized agents (HR, IT, Finance) that each build domain expertise while sharing verified facts across the organization. The Agent Awareness Engine lets any agent query what others know, enabling intelligent routing.

### Customer Support
Support agents that remember customer history, past issues, resolution steps, and preferences. The procedural memory system captures successful resolution patterns that can be applied to similar future cases.

### Research Assistants
Agents that accumulate domain knowledge over weeks of research, building a connected knowledge graph of papers, concepts, and findings. Flash reasoning chains surface non-obvious connections between disparate pieces of information.

### DevOps & Infrastructure Management
Agents that remember infrastructure topology, past incidents, configuration changes, and runbook procedures. Temporal graph queries answer "What changed between the last stable state and the current failure?"

### Personal AI Companions
Long-running personal assistants that learn user preferences, remember conversations, and develop a genuine understanding of the user over time — not just retrieving facts, but modeling the relationship.

---

## Roadmap

### V1 — Current Release
**Status: Production**

- 9 tools: recall, store, forget, block get/set, feedback, consolidate, agent awareness
- 5-layer architecture fully operational
- 12-step zero-LLM ingestion pipeline
- Multi-signal intent-aware retrieval with diversity reranking
- Activation decay with configurable rates per urgency
- Temporal knowledge graph with auto-linking
- Reinforcement learning feedback loop
- Active consolidation (4 phases)
- Flash reasoning chain traversal
- Agent Awareness Engine with knowledge gap analysis
- Mesh Sync shared blocks
- Cross-agent broadcast with corroboration
- Session survival across context compaction
- Two-tier caching with automatic invalidation
- Proactive recall with gap-filling queries
- Procedural memory (skill library)
- Observation compression for conversation efficiency
- CLI for operations and maintenance

### V2 — Next Release
**Status: Architecture Complete, Implementation Planned**

| Feature | Description |
|---------|-------------|
| **Auto Pattern Mining** | TF-IDF + co-occurrence clustering to discover recurring themes |
| **Auto Lesson Extraction** | Detects corrections in conversations, auto-stores as reusable lessons |
| **Temporal Sequences** | "A → B within N hours" sequence detection in knowledge graph |
| **Preference Tracking** | Running user preference model maintained in shared blocks |
| **Spreading Activation** | Graph-based activation propagation (1-hop=0.6, 2-hop=0.3 decay) |
| **BM25 Hybrid Search** | Text index + vector search fused via Reciprocal Rank Fusion |
| **Enhanced Intent Routing** | Additional intents: causal, comparative — with specialized retrieval strategies |
| **Pattern Abstraction** | Episode clusters → abstract rules ("when X happens, Y follows") |
| **Proactive Warning System** | "Last time you did X, Y broke" — warns before repeating mistakes |
| **Dream Consolidation** | Nightly batch: full consolidation + pattern mining + sequence detection |
| **Cross-Agent Knowledge Synthesis** | 3+ agent agreement triggers automatic synthesis of fleet-level insights |
| **Sentiment-Aware Retrieval** | Emotion detection adjusts retrieval strategy and priority |

### V3 — Vision
**Status: Design Phase**

- **Hierarchical Memory:** Episode → Semantic → Schema abstraction layers
- **Multi-Modal Memory:** Image, audio, and document embeddings alongside text
- **Federated Memory:** Cross-organization memory sharing with privacy boundaries
- **Predictive Recall:** Anticipate what memories will be needed based on conversation trajectory
- **Memory Compression:** Lossy summarization of old episodic memories to save space while retaining key facts
- **Natural Language Memory Management:** "Forget everything about project X except the final architecture decision"
- **Custom Decay Models:** Per-domain or per-user decay curves learned from usage patterns
- **Distributed Graph:** Sharded knowledge graph for billion-node scale

---

## Technical Specifications

| Specification | Detail |
|--------------|--------|
| **Language** | TypeScript (Node.js runtime) |
| **Embedding Dimensions** | 768 (Nomic text architecture) |
| **Embedding Compatibility** | Any OpenAI-compatible `/v1/embeddings` endpoint |
| **Vector Database** | Qdrant (required) |
| **Graph Database** | FalkorDB / RedisGraph (optional) |
| **Cache / Pub/Sub** | Redis (optional, enables L2 cache + multi-agent broadcast) |
| **Memory Types** | 7 (episodic, semantic, preference, relationship, procedural, profile, core) |
| **Confidence Tiers** | 4 (Mesh Fact, Grounded, Inferred, Uncertain) |
| **Urgency Levels** | 4 (critical, important, reference, background) |
| **Domains** | 5 (technical, personal, project, knowledge, general) |
| **Pipeline Steps** | 12 (all zero-LLM) |
| **Search Signals** | 5 (similarity, recency, importance×confidence, frequency, type relevance) |
| **Query Intents** | 5 (factual, temporal, procedural, preference, exploratory) |
| **Tools** | 9 |
| **Max Embedding Cache** | 512 entries, 5-min TTL |
| **L1 Cache** | 50 entries, 5-min TTL, LRU eviction |
| **L2 Cache** | 1-hour TTL, pattern-based invalidation |
| **Auto-Link Threshold** | 0.70 cosine similarity (configurable) |
| **Duplicate Threshold** | 0.92 cosine similarity |
| **Conflict Detection Range** | 0.70 - 0.92 cosine similarity |
| **Graph Max Depth** | 3 hops (configurable) |
| **License** | Open Source |

---

## Getting Started

### Quick Start (Single Node)

```bash
# 1. Start backing services
docker run -d -p 6333:6333 qdrant/qdrant
docker run -d -p 6379:6379 redis
docker run -d -p 6380:6379 falkordb/falkordb

# 2. Install Mnemosyne
npm install mnemosy-ai

# 3. Configure
export MNEMOSYNE_VECTOR_DB=http://localhost:6333
export MNEMOSYNE_EMBED_URL=http://localhost:11434/v1/embeddings
export MNEMOSYNE_REDIS_URL=redis://localhost:6379
export MNEMOSYNE_GRAPH_URL=redis://localhost:6380
export MNEMOSYNE_AGENT_ID=my-agent

# 4. Integrate with your agent framework
import { Mnemosyne } from 'mnemosy-ai'
```

### Minimal Configuration (Vector-Only)

```typescript
const config = {
  vectorDbUrl: 'http://localhost:6333',
  embeddingUrl: 'http://localhost:11434/v1/embeddings',
  agentId: 'my-agent',
  // Disable optional features
  enableGraph: false,
  enableBroadcast: false,
}
```

### Full Configuration (All Features)

```typescript
const config = {
  vectorDbUrl: 'http://qdrant-host:6333',
  embeddingUrl: 'http://embed-host:11434/v1/embeddings',
  graphDbUrl: 'redis://falkordb-host:6380',
  cacheUrl: 'redis://redis-host:6379',
  agentId: 'production-agent-01',
  autoCapture: true,
  autoRecall: true,
  enableGraph: true,
  enableAutoLink: true,
  enableDecay: true,
  enableBroadcast: true,
  enablePriorityScoring: true,
  enableConfidenceTags: true,
  autoLinkThreshold: 0.70,
}
```

---

<p align="center">
  <strong>Mnemosyne</strong> — Because intelligence without memory isn't intelligence.
</p>
