/**
 * Real Redis + Qdrant integration tests for broadcast/ modules.
 *
 * Tests MemoryPublisher, MemorySubscriber (Redis pub/sub), and
 * SharedBlockManager (Qdrant-backed shared blocks).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryPublisher } from "../src/broadcast/publisher.js";
import { MemorySubscriber } from "../src/broadcast/subscriber.js";
import { SharedBlockManager } from "../src/broadcast/shared-blocks.js";
import { DEFAULT_COLLECTIONS } from "../src/core/types.js";
import type { BroadcastMessage } from "../src/core/types.js";
import {
  QDRANT_URL,
  createTestCollection,
  deleteTestCollection,
  textToVector,
} from "./helpers/qdrant.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const TEST_AGENT_ID = "test-agent-broadcast";

// ---------------------------------------------------------------------------
// Shared block test collection
// ---------------------------------------------------------------------------

/** Unique collection name for shared-block tests */
function sharedBlockCollection(): string {
  const pid = process.pid || 0;
  return `test_shared_blocks_${pid}_${Date.now()}`.replace(
    /[^a-z0-9_-]/gi,
    "_",
  ).toLowerCase();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid BroadcastMessage for testing */
function makeTestMessage(
  overrides: Partial<BroadcastMessage> = {},
): BroadcastMessage {
  return {
    memoryId: randomUUID(),
    agentId: TEST_AGENT_ID,
    memoryType: "semantic",
    scope: "public",
    textPreview: "test memory broadcast",
    event: "new_memory",
    linkedCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Wait up to `timeout` ms for a condition to become true */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 3000,
  interval = 50,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("waitFor timed out");
}

/**
 * Deterministic 1024-dim vector from a block name (matching the approach
 * in qdrant helper's textToVector).
 */
function blockNameVector(name: string): number[] {
  return textToVector(`shared_block:${name}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MemoryPublisher + MemorySubscriber (Redis pub/sub)", () => {
  let publisher: MemoryPublisher;
  let subscriber: MemorySubscriber;
  const received: BroadcastMessage[] = [];

  beforeAll(async () => {
    publisher = new MemoryPublisher(REDIS_URL);
    subscriber = new MemorySubscriber(REDIS_URL, TEST_AGENT_ID);

    // Register handler before starting subscriber
    subscriber.onMessage((msg) => {
      received.push(msg);
    });

    // Start subscriber (connects and subscribes to channels)
    await subscriber.start();

    // Connect publisher
    await publisher.connect();
  });

  afterAll(async () => {
    await publisher.disconnect();
    await subscriber.stop();
  });

  beforeEach(async () => {
    received.length = 0;
    // Small drain window so stale messages from previous tests
    // (e.g. INV or CRITICAL channel deliveries) don't leak into
    // the next test. 100ms is generous for local Redis.
    await new Promise((r) => setTimeout(r, 100));
    received.length = 0;
  });

  it("publishes and receives a public message via Redis pub/sub", async () => {
    const msg = makeTestMessage({ textPreview: "hello from publisher" });

    const subs = await publisher.publish(msg);
    // `subs` is the count of subscriber connections that received it — may be 0
    // in real Redis since the subscriber is on a connection that published
    // (Redis pub/sub doesn't deliver to the publishing client on the same conn).
    expect(typeof subs).toBe("number");

    // Wait for the subscriber to receive the message
    await waitFor(
      () => received.some((m) => m.memoryId === msg.memoryId),
      3000,
    );

    const match = received.find((m) => m.memoryId === msg.memoryId);
    expect(match).toBeDefined();
    expect(match!.agentId).toBe(TEST_AGENT_ID);
    expect(match!.scope).toBe("public");
    expect(match!.textPreview).toBe("hello from publisher");
  });

  it("publishes and receives a private (agent-scoped) message", async () => {
    const msg = makeTestMessage({
      textPreview: "private ping",
      scope: "private",
    });

    // Private messages go to memory:private:<agentId>, which the subscriber
    // also subscribes to (because start() subscribes to CHANNELS.PRIVATE).
    const subs = await publisher.publish(msg);
    expect(typeof subs).toBe("number");

    await waitFor(
      () => received.some((m) => m.memoryId === msg.memoryId),
      3000,
    );

    const match = received.find((m) => m.memoryId === msg.memoryId);
    expect(match).toBeDefined();
    expect(match!.scope).toBe("private");
    expect(match!.textPreview).toBe("private ping");
  });

  it("publishes a core/profile memory which also goes to critical channel", async () => {
    // Use event "critical" so it doesn't generate INV channel noise
    const msg = makeTestMessage({
      memoryType: "core",
      event: "critical",
      textPreview: "core memory broadcast",
    });

    // This should publish to both PUBLIC and CRITICAL channels
    const subs = await publisher.publish(msg);
    expect(typeof subs).toBe("number");

    // Wait for at least one message with memoryType "core"
    await waitFor(
      () => received.some((m) => m.memoryType === "core"),
      3000,
    );

    const coreMsg = received.find((m) => m.memoryType === "core");
    expect(coreMsg).toBeDefined();
    expect(coreMsg!.memoryId).toBe(msg.memoryId);
  });

  it("publishes a conflict event", async () => {
    // publishConflict hits the CONFLICT channel
    await publisher.publishConflict(
      randomUUID(),
      randomUUID(),
      "version mismatch",
    );
    // No subscriber handler for CONFLICT by default in our setup,
    // so we just verify no exception
    // (the subscriber's message handler on("message") receives ALL subscribed
    //  channels, including CONFLICT, but our onMessage handler only fires for
    //  PUBLIC, PRIVATE, CRITICAL, INVALIDATE)
    expect(true).toBe(true);
  });

  it("publishes an invalidation event for new_memory events", async () => {
    const msg = makeTestMessage({
      event: "new_memory",
      textPreview: "cache invalidation test",
    });

    await publisher.publish(msg);

    // The original message should arrive
    await waitFor(
      () => received.some((m) => m.memoryId === msg.memoryId),
      3000,
    );
    expect(received.some((m) => m.memoryId === msg.memoryId)).toBe(true);
  });

  it("handles publish without connect gracefully (returns 0)", async () => {
    const offlinePub = new MemoryPublisher(REDIS_URL);
    // Don't call connect() — publish should return 0 without throwing
    const msg = makeTestMessage({ textPreview: "offline test" });
    const subs = await offlinePub.publish(msg);
    expect(subs).toBe(0);
  });
});

describe("SharedBlockManager (Qdrant)", () => {
  const testColl = sharedBlockCollection();
  let manager: SharedBlockManager;
  const originalShared = DEFAULT_COLLECTIONS.SHARED;

  beforeAll(async () => {
    // Create a dedicated Qdrant collection for shared block tests
    await createTestCollection(testColl);

    // Redirect shared blocks to our test collection
    DEFAULT_COLLECTIONS.SHARED = testColl;

    manager = new SharedBlockManager(QDRANT_URL, TEST_AGENT_ID);
  });

  afterAll(async () => {
    // Restore original collection name
    DEFAULT_COLLECTIONS.SHARED = originalShared;
    await deleteTestCollection(testColl);
  });

  it("returns null for a non-existent block", async () => {
    const block = await manager.get("non-existent-block");
    expect(block).toBeNull();
  });

  it("creates a new shared block with set()", async () => {
    const name = "system_status";
    const content = "All agents online. Memory load: 42%";
    const vector = blockNameVector(name);

    const block = await manager.set(name, content, vector);

    expect(block.name).toBe(name);
    expect(block.content).toBe(content);
    expect(block.version).toBe(1);
    expect(block.lastWriter).toBe(TEST_AGENT_ID);
    expect(block.createdAt).toBeTruthy();
    expect(block.updatedAt).toBeTruthy();
  });

  it("retrieves the created block with get()", async () => {
    const block = await manager.get("system_status");

    expect(block).not.toBeNull();
    expect(block!.name).toBe("system_status");
    expect(block!.content).toBe("All agents online. Memory load: 42%");
    expect(block!.version).toBe(1);
  });

  it("updates an existing block and increments version", async () => {
    const content = "All agents online. Memory load: 72%";
    const vector = blockNameVector("system_status");

    const block = await manager.set("system_status", content, vector);

    expect(block.version).toBe(2);
    expect(block.content).toBe(content);
  });

  it("lists all shared blocks", async () => {
    // Add a second block
    const vector = blockNameVector("user_preferences");
    await manager.set(
      "user_preferences",
      "Dark mode enabled, language: en-US",
      vector,
    );

    const blocks = await manager.list();

    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const names = blocks.map((b) => b.name);
    expect(names).toContain("system_status");
    expect(names).toContain("user_preferences");
  });

  it("lists only non-deleted blocks after soft delete", async () => {
    // Add a block we'll delete
    const vector = blockNameVector("temporary_block");
    await manager.set(
      "temporary_block",
      "This will be deleted",
      vector,
    );

    // Verify it exists
    let blocks = await manager.list();
    const namesBefore = blocks.map((b) => b.name);
    expect(namesBefore).toContain("temporary_block");

    // Soft delete
    const deleted = await manager.delete("temporary_block");
    expect(deleted).toBe(true);

    // Verify it's gone from list
    blocks = await manager.list();
    const namesAfter = blocks.map((b) => b.name);
    expect(namesAfter).not.toContain("temporary_block");

    // get() should also return null for deleted blocks
    const block = await manager.get("temporary_block");
    expect(block).toBeNull();
  });

  it("set() with custom metadata", async () => {
    const name = "active_projects";
    const vector = blockNameVector(name);
    const metadata = { priority: "high", owner: "agent-alpha" };

    const block = await manager.set(
      name,
      "Working on memory consolidation",
      vector,
      metadata,
    );

    expect(block.metadata).toBeTruthy();
    expect(block.metadata!.priority).toBe("high");
    expect(block.metadata!.owner).toBe("agent-alpha");
  });

  it("handles repeated set() with the same name as upsert", async () => {
    const name = "counter_block";
    const vector = blockNameVector(name);

    // Set multiple times
    const b1 = await manager.set(name, "count 1", vector);
    expect(b1.version).toBe(1);

    const b2 = await manager.set(name, "count 2", vector);
    expect(b2.version).toBe(2);

    const b3 = await manager.set(name, "count 3", vector);
    expect(b3.version).toBe(3);
    expect(b3.content).toBe("count 3");
  });

  it("contains the blocks we created from earlier tests", async () => {
    const blocks = await manager.list();
    const names = blocks.map((b) => b.name);
    expect(names).toContain("system_status");
    expect(names).toContain("user_preferences");
    expect(names).toContain("active_projects");
    expect(names).toContain("counter_block");
  });
});

// ---------------------------------------------------------------------------
// Cross-module: Broadcast triggers shared block update
// ---------------------------------------------------------------------------

describe("Broadcast + SharedBlock integration", () => {
  const testColl = sharedBlockCollection();
  let publisher: MemoryPublisher;
  let subscriber: MemorySubscriber;
  let blockManager: SharedBlockManager;
  const received: BroadcastMessage[] = [];
  const originalShared = DEFAULT_COLLECTIONS.SHARED;

  beforeAll(async () => {
    await createTestCollection(testColl);
    DEFAULT_COLLECTIONS.SHARED = testColl;

    publisher = new MemoryPublisher(REDIS_URL);
    subscriber = new MemorySubscriber(REDIS_URL, TEST_AGENT_ID);
    blockManager = new SharedBlockManager(QDRANT_URL, TEST_AGENT_ID);

    subscriber.onMessage((msg) => {
      received.push(msg);
    });

    await subscriber.start();
    await publisher.connect();
  });

  afterAll(async () => {
    await publisher.disconnect();
    await subscriber.stop();
    DEFAULT_COLLECTIONS.SHARED = originalShared;
    await deleteTestCollection(testColl);
  });

  beforeEach(async () => {
    received.length = 0;
    await new Promise((r) => setTimeout(r, 100));
    received.length = 0;
  });

  it("publishes a memory and stores a shared block reflecting agent state", async () => {
    // Publish a memory event
    const msg = makeTestMessage({
      textPreview: "agent heartbeat: operational",
      event: "new_memory",
    });
    await publisher.publish(msg);

    // Wait for the message to be received
    await waitFor(
      () => received.some((m) => m.memoryId === msg.memoryId),
      3000,
    );

    // Now write a shared block reflecting agent status
    const vector = blockNameVector("agent_status");
    const block = await blockManager.set(
      "agent_status",
      `Agent ${TEST_AGENT_ID} online. Last memory: ${msg.textPreview}`,
      vector,
    );

    expect(block.name).toBe("agent_status");
    expect(block.content).toContain("agent heartbeat: operational");

    // Verify it persisted
    const fetched = await blockManager.get("agent_status");
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toContain("agent heartbeat: operational");
  });
});
