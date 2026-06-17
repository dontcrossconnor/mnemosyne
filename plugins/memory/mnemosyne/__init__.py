"""Mnemosyne memory provider for Hermes Agent.

Persistent vector memory with semantic recall, memory classification,
ACT-R decay, multi-signal scoring, and cross-agent awareness (ToMA).

Requires Qdrant + Ollama running. Configuration via 'hermes memory setup'.

Profile isolation modes:
  - Shared pool (default): all profiles share memory, private per agentId
  - Total isolation: each profile gets its own Qdrant collections
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error
from .bridge import MnemosyneBridge
from .cli import get_config_schema, load_config, save_config

logger = logging.getLogger(__name__)

# ==============================================================================
# Tool Schemas
# ==============================================================================

MEMORY_RECALL_SCHEMA = {
    "name": "memory_recall",
    "description": (
        "Semantic memory search across past conversations. "
        "Returns memories ranked by relevance, recency, importance, and type match. "
        "Use this to recall facts, preferences, procedures, and past events. "
        "Supports intent-aware scoring: factual, temporal, procedural, preference, exploratory."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Natural language search query"},
            "limit": {"type": "integer", "description": "Max results (default: 5)", "default": 5},
        },
        "required": ["query"],
    },
}

MEMORY_STORE_SCHEMA = {
    "name": "memory_store",
    "description": (
        "Store a fact, preference, procedure, or event into long-term memory. "
        "Automatically classified by type (semantic, procedural, preference, episodic, etc), "
        "urgency, and domain. Duplicates are auto-merged."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Content to memorize"},
            "importance": {"type": "number", "description": "Importance 0.0-1.0 (default: 0.7)"},
        },
        "required": ["text"],
    },
}

MEMORY_TOMA_SCHEMA = {
    "name": "memory_toma",
    "description": (
        "Theory of Mind for Agents — query what another Hermes profile/agent "
        "knows about a topic. Only works in shared-pool mode (not isolated). "
        "Use this to understand what other agents have learned and avoid "
        "redundant questions."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent_id": {"type": "string", "description": "Target agent/profile identifier to query"},
            "topic": {"type": "string", "description": "What to ask about"},
            "limit": {"type": "integer", "description": "Max results (default: 5)"},
        },
        "required": ["agent_id", "topic"],
    },
}

MEMORY_FORGET_SCHEMA = {
    "name": "memory_forget",
    "description": "Delete a memory by its ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "Memory ID to delete"},
        },
        "required": ["id"],
    },
}

# ==============================================================================
# Provider
# ==============================================================================


class MnemosyneMemoryProvider(MemoryProvider):
    """Memory provider backed by Mnemosyne (Qdrant + embeddings)."""

    def __init__(self):
        self._bridge: Optional[MnemosyneBridge] = None
        self._hermes_home = ""
        self._agent_identity = ""
        self._session_id = ""

    # -- Properties -----------------------------------------------------------

    @property
    def name(self) -> str:
        return "mnemosyne"

    # -- Lifecycle ------------------------------------------------------------

    def is_available(self) -> bool:
        """Check if config exists and deps are available."""
        from .cli import is_installed as _check_deps
        return _check_deps()

    def initialize(self, session_id: str, **kwargs) -> None:
        """Start the Mnemosyne bridge."""
        self._hermes_home = kwargs.get("hermes_home", os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))
        self._session_id = session_id

        # Use agent_identity (profile name) as the Mnemosyne agentId
        self._agent_identity = kwargs.get("agent_identity", "hermes")

        self._bridge = MnemosyneBridge(self._hermes_home)
        self._bridge.start(self._agent_identity)

    def shutdown(self) -> None:
        """Shut down the bridge."""
        if self._bridge:
            self._bridge.shutdown()
            self._bridge = None

    # -- System Prompt --------------------------------------------------------

    def system_prompt_block(self) -> str:
        config = load_config(self._hermes_home)
        isolated = config.get("isolated", False)

        lines = [
            "## Mnemosyne Memory System",
            f"You have persistent memory backed by vector search (agent: {self._agent_identity}).",
            "Use `memory_recall` to retrieve relevant memories before answering.",
            "Use `memory_store` to save important facts, preferences, and procedures.",
            "Use `memory_toma` to learn what other profiles know about a topic." if not isolated else "",
        ]
        return "\n".join(filter(None, lines))

    # -- Turn Lifecycle -------------------------------------------------------

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall relevant context for the upcoming turn."""
        if not self._bridge:
            return ""

        try:
            results = self._bridge.recall(query, limit=5)
            if not results:
                return ""

            lines = ["--- Relevant memories ---"]
            for i, r in enumerate(results, 1):
                meta = f"[{r.get('memoryType', '?')}]"
                if r.get("confidence"):
                    meta += f" conf={r['confidence']:.1f}"
                if r.get("agentId") and r["agentId"] != self._agent_identity:
                    meta += f" (agent: {r['agentId']})"
                text = r.get("text", "")
                lines.append(f"{i}. {meta} {text[:300]}")
            return "\n".join(lines)
        except Exception:
            logger.warning("Mnemosyne prefetch failed", exc_info=True)
            return ""

    def sync_turn(self, user_content: str, assistant_content: str, *,
                  session_id: str = "", messages: Optional[List[Dict[str, Any]]] = None) -> None:
        """Store assistant response as a memory."""
        if not self._bridge:
            return

        # Store the exchange if it contains meaningful content
        text = assistant_content.strip()
        if len(text) > 20:
            try:
                self._bridge.store(text, {"importance": 0.5})
            except Exception:
                pass

    # -- Tools ----------------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        schemas = [MEMORY_RECALL_SCHEMA, MEMORY_STORE_SCHEMA, MEMORY_FORGET_SCHEMA]

        # Only expose ToMA in shared-pool mode (not isolated)
        config = load_config(self._hermes_home)
        if not config.get("isolated", False):
            schemas.append(MEMORY_TOMA_SCHEMA)

        return schemas

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._bridge:
            return tool_error(f"Mnemosyne bridge not started")

        try:
            if tool_name == "memory_recall":
                results = self._bridge.recall(
                    query=args.get("query", ""),
                    limit=args.get("limit", 5),
                )
                return json.dumps({"ok": True, "results": results})

            elif tool_name == "memory_store":
                mem_id = self._bridge.store(
                    text=args.get("text", ""),
                    opts={"importance": args.get("importance", 0.7)},
                )
                return json.dumps({"ok": True, "id": mem_id})

            elif tool_name == "memory_forget":
                deleted = self._bridge.forget(args.get("id", ""))
                return json.dumps({"ok": True, "deleted": deleted})

            elif tool_name == "memory_toma":
                results = self._bridge.toma(
                    target_agent=args.get("agent_id", ""),
                    topic=args.get("topic", ""),
                    limit=args.get("limit", 5),
                )
                return json.dumps({"ok": True, "results": results})

            return tool_error(f"Unknown tool: {tool_name}")

        except Exception as e:
            logger.warning("Mnemosyne tool call failed: %s", e, exc_info=True)
            return tool_error(str(e))

    # -- Config ---------------------------------------------------------------

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return get_config_schema()

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        save_config(values, hermes_home)


# ==============================================================================
# Registration — discovered by Hermes plugin system
# ==============================================================================

def register(ctx):
    """Register the Mnemosyne memory provider."""
    ctx.register_memory_provider(MnemosyneMemoryProvider())
