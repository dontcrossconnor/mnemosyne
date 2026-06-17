"""Mnemosyne memory provider — stdio JSON-RPC bridge to TypeScript backend."""

from __future__ import annotations

import fcntl
import json
import logging
import os
import subprocess
import sys
import threading
from typing import Any, Dict, List, Optional

from .cli import get_bridge_command, load_config, is_installed

logger = logging.getLogger(__name__)


class MnemosyneBridge:
    """Manages a long-running Mnemosyne bridge subprocess over stdio JSON-RPC."""

    def __init__(self, hermes_home: str):
        config = load_config(hermes_home)
        self._qdrant_url = config.get("qdrant_url", "http://localhost:6333")
        self._embedding_url = config.get("embedding_url", "http://localhost:11434/v1/embeddings")
        self._model = config.get("embedding_model", "nomic-embed-text")
        self._isolated = config.get("isolated", False)
        self._agent_id = ""
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._read_thread: Optional[threading.Thread] = None
        self._responses: Dict[int, threading.Event] = {}
        self._results: Dict[int, Any] = {}
        self._buffer = ""

    def start(self, agent_id: str) -> None:
        """Start the bridge subprocess."""
        self._agent_id = agent_id
        try:
            cmd = get_bridge_command(
                self._qdrant_url,
                self._embedding_url,
                agent_id,
                self._model,
                self._isolated,
            )
        except RuntimeError as e:
            logger.warning("Mnemosyne bridge: %s", e)
            return

        logger.info("Starting Mnemosyne bridge: %s", " ".join(cmd))
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        # Start reader thread
        self._read_thread = threading.Thread(target=self._reader, daemon=True)
        self._read_thread.start()

        # Wait for ready signal
        try:
            resp = self._send("ping", timeout=10)
            if resp and resp.get("ready"):
                logger.info("Mnemosyne bridge ready for agent '%s'", agent_id)
            else:
                logger.warning("Mnemosyne bridge responded but not ready")
        except TimeoutError:
            logger.warning("Mnemosyne bridge did not respond to ping within 10s")

    def _send(self, cmd: str, args: Optional[Dict[str, Any]] = None, timeout: float = 30) -> Any:
        """Send a command and wait for response."""
        if not self._proc or not self._proc.stdin:
            raise RuntimeError("Bridge not started")

        with self._lock:
            req_id = self._next_id
            self._next_id += 1
            event = threading.Event()
            self._responses[req_id] = event

        req = json.dumps({"id": req_id, "cmd": cmd, "args": args or {}}) + "\n"
        self._proc.stdin.write(req)
        self._proc.stdin.flush()

        if not event.wait(timeout=timeout):
            with self._lock:
                self._responses.pop(req_id, None)
            raise TimeoutError(f"Bridge command '{cmd}' timed out after {timeout}s")

        with self._lock:
            result = self._results.pop(req_id, None)

        if result is None:
            raise RuntimeError(f"No response for command '{cmd}'")
        if not result.get("ok"):
            raise RuntimeError(result.get("error", f"Command '{cmd}' failed"))
        return result.get("result")

    def _reader(self) -> None:
        """Read JSON lines from bridge stdout and dispatch responses."""
        if not self._proc or not self._proc.stdout:
            return

        # Set stdout to non-blocking
        fd = self._proc.stdout.fileno()
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        while True:
            try:
                line = self._proc.stdout.readline()
                if not line:
                    # Check if process died
                    if self._proc.poll() is not None:
                        break
                    continue

                line = line.strip()
                if not line:
                    continue

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                req_id = msg.get("id")
                if req_id is not None:
                    with self._lock:
                        event = self._responses.pop(req_id, None)
                        if event:
                            self._results[req_id] = msg
                            event.set()
            except Exception:
                break

        # Process died
        stderr_output = ""
        if self._proc and self._proc.stderr:
            try:
                stderr_output = self._proc.stderr.read()
            except Exception:
                pass
        if stderr_output:
            logger.warning("Mnemosyne bridge stderr: %s", stderr_output.strip())

    def store(self, text: str, opts: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Store a memory. Returns memory ID or None."""
        result = self._send("store", {"text": text, "opts": opts or {}})
        return result.get("id") if result else None

    def recall(self, query: str, limit: int = 5, min_score: float = 0.3) -> List[Dict[str, Any]]:
        """Recall memories matching query. Returns list of dicts."""
        result = self._send("recall", {"query": query, "opts": {"limit": limit, "minScore": min_score}})
        return result or []

    def forget(self, memory_id: str) -> bool:
        """Forget a memory by ID."""
        result = self._send("forget", {"id": memory_id})
        return result.get("deleted", False) if result else False

    def toma(self, target_agent: str, topic: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Theory of Mind: query what another agent knows about a topic."""
        result = self._send("toma", {
            "agent_id": target_agent,
            "topic": topic,
            "limit": limit,
        })
        return result or []

    def profile(self, target_agent: Optional[str] = None) -> Dict[str, Any]:
        """Get an agent's memory profile."""
        args = {}
        if target_agent:
            args["agent_id"] = target_agent
        result = self._send("profile", args)
        return result or {}

    def ping(self) -> bool:
        """Check if bridge is alive."""
        try:
            result = self._send("ping", timeout=5)
            return result is not None
        except Exception:
            return False

    def shutdown(self) -> None:
        """Shut down the bridge process."""
        try:
            self._send("exit", timeout=2)
        except Exception:
            pass

        if self._proc:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                self._proc.kill()
            self._proc = None
