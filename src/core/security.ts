/**
 * Three-tier memory classification.
 * SECRET → never stored, never broadcast.
 * PRIVATE → agent-scoped collection.
 * PUBLIC → shared collection.
 */
import type { Classification } from "./types.js";

const SECRET_PATTERNS = [
  /password/i,
  /passwd/i,
  /\bpw:/i,
  /\bsecret\b/i,
  /api.?key/i,
  /ssh.?key/i,
  /id_rsa/i,
  /private.?key/i,
  /\btoken\b/i,
  // Credit card: grouped (4111-1111-1111-1111) or consecutive (4111111111111111)
  /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/,
  /\b\d{16}\b/,
  // SSN
  /\b\d{3}-\d{2}-\d{4}\b/,
];

const PRIVATE_TYPES = new Set(["soul", "lesson", "error"]);

export function classifyMemory(
  content: string,
  context: { agentId?: string; type?: string } = {},
): Classification {
  const lower = content.toLowerCase();
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(lower)) return "secret";
  }
  if (context.agentId && context.type && PRIVATE_TYPES.has(context.type)) {
    return "private";
  }
  return "public";
}
