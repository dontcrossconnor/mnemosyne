"""Mnemosyne memory provider — CLI configuration (hermes memory setup)."""

from __future__ import annotations

import json, os, shutil, subprocess, sys
from typing import Any, Dict, List
from pathlib import Path

_MNEMOSYNE_SRC = os.path.expanduser("~/mnemosyne-rebuild")


def _find_tsx() -> str | None:
    """Find tsx interpreter — check project node_modules first, then global."""
    local_tsx = os.path.join(_MNEMOSYNE_SRC, "node_modules", ".bin", "tsx")
    if os.path.isfile(local_tsx):
        return local_tsx
    local_tsx = os.path.join(_MNEMOSYNE_SRC, "node_modules", ".bin", "tsx.exe")
    if os.path.isfile(local_tsx):
        return local_tsx
    return shutil.which("tsx")


def _find_npx() -> str | None:
    return shutil.which("npx")


def is_installed() -> bool:
    """Check if Mnemosyne bridge dependencies are available."""
    src = Path(_MNEMOSYNE_SRC)
    if not src.exists():
        return False
    package_json = src / "package.json"
    if not package_json.exists():
        return False
    # Check for node_modules or tsx availability
    if _find_tsx() or _find_npx():
        return True
    node_modules = src / "node_modules"
    return node_modules.exists() and (node_modules / "mnemosy-ai").exists()


def get_bridge_command(qdrant_url: str, embedding_url: str, agent_id: str, model: str, isolated: bool = False) -> List[str]:
    """Return the command to start the Mnemosyne bridge process."""
    bridge_ts = os.path.join(_MNEMOSYNE_SRC, "src", "bridge.ts")
    collection_prefix = f"{agent_id}" if isolated else ""
    tsx = _find_tsx()

    if tsx:
        return [tsx, bridge_ts, qdrant_url, embedding_url, agent_id, model, collection_prefix]
    npx = _find_npx()
    if npx:
        return [npx, "--yes", "tsx", bridge_ts, qdrant_url, embedding_url, agent_id, model, collection_prefix]
    # Fallback: try node with ts-node or compiled JS
    compiled_js = os.path.join(_MNEMOSYNE_SRC, "dist", "bridge.js")
    if os.path.isfile(compiled_js):
        return ["node", compiled_js, qdrant_url, embedding_url, agent_id, model]
    raise RuntimeError(
        "Cannot start Mnemosyne bridge: tsx not found and no compiled bridge.js. "
        "Run 'npm install && npm run build' in ~/mnemosyne-rebuild/"
    )


def get_config_schema() -> List[Dict[str, Any]]:
    """Return config fields for 'hermes memory setup' wizard."""
    return [
        {
            "key": "qdrant_url",
            "description": "Qdrant vector database URL",
            "required": True,
            "default": "http://localhost:6333",
        },
        {
            "key": "embedding_url",
            "description": "Embedding service URL (OpenAI-compatible or Ollama)",
            "required": True,
            "default": "http://localhost:11434/v1/embeddings",
        },
        {
            "key": "embedding_model",
            "description": "Embedding model name",
            "required": False,
            "default": "mxbai-embed-large",
        },
        {
            "key": "isolated",
            "description": "Total isolation per profile (disables ToMA). false = shared pool with agentId scoping (ToMA works)",
            "required": False,
            "default": "false",
            "choices": ["true", "false"],
        },
    ]


def save_config(values: Dict[str, Any], hermes_home: str) -> None:
    """Write non-secret config to the provider's native location."""
    config_dir = os.path.join(hermes_home, "config")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "mnemosyne.json")

    existing = {}
    if os.path.isfile(config_path):
        with open(config_path) as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                pass

    existing.update(values)
    with open(config_path, "w") as f:
        json.dump(existing, f, indent=2)


def load_config(hermes_home: str) -> Dict[str, str]:
    """Load saved Mnemosyne config."""
    config_path = os.path.join(hermes_home, "config", "mnemosyne.json")
    if not os.path.isfile(config_path):
        return {}
    with open(config_path) as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}
