#!/usr/bin/env python3
"""Brain-usage enforcement hook for VS Code agent sessions.

Fires on SessionStart, PostToolUse, PreCompact and Stop. Reads the Obsidian
brain activity log to decide whether the agent has saved anything during the
current session, then injects a reminder or blocks completion when it has not.

Why this exists: the brain instruction is guidance only, so "search first,
save as you go" is non-deterministic. This hook is the deterministic half --
it observes the activity log the brain MCP server already writes and reacts.

Contract: JSON on stdin, JSON on stdout. The hook never fails closed -- any
parse or IO error exits 0 with no output, so a broken hook cannot wedge a
session. Exit code 2 is reserved for a deliberate block.

Usage:
    python3 brain_guard.py --event SessionStart
    python3 brain_guard.py --event PostToolUse   # event also read from stdin
    python3 brain_guard.py --self-test
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

# A save line looks like: "- 2026-10-13T03:31:43.580Z append _Inbox/foo.md"
SAVE_LINE_RE = re.compile(
    r"^-\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(\S+)\s+(.+)$"
)

REMIND_EVERY_CALLS = 5
CLOCK_SKEW_GRACE = 5.0
MAX_MESSAGE_CHARS = 1200

PROTOCOL_TEXT = (
    "BRAIN PROTOCOL (enforced by hook):\n"
    "1. SEARCH the brain before starting work.\n"
    "2. SAVE insights as you go -- every 3-5 tool calls, not at the end.\n"
    "3. SAVE a summary before finishing.\n"
    "Use obsidian_brain: operation=\"search\" / \"quick_note\" / \"append\"."
)


# --------------------------------------------------------------------------
# IO helpers
# --------------------------------------------------------------------------
def read_stdin_json() -> dict:
    """Read the hook payload from stdin, tolerating anything malformed."""
    try:
        raw = sys.stdin.read()
    except Exception:
        return {}
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def clip(text: str, limit: int = MAX_MESSAGE_CHARS) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."


# --------------------------------------------------------------------------
# Vault discovery
# --------------------------------------------------------------------------
def vault_path() -> Path | None:
    """Locate the brain vault: env override, then VS Code settings, then default."""
    env = os.environ.get("OBSIDIAN_BRAIN_VAULT")
    if env:
        candidate = Path(env).expanduser()
        if candidate.is_dir():
            return candidate

    settings_candidates = [
        Path.home() / "Library/Application Support/Code/User/settings.json",
        Path.home() / ".config/Code/User/settings.json",
        Path.home() / "AppData/Roaming/Code/User/settings.json",
    ]
    for settings in settings_candidates:
        if not settings.is_file():
            continue
        try:
            cfg = json.loads(settings.read_text(encoding="utf-8"))
        except Exception:
            continue
        configured = cfg.get("obsidianBrain.vaultPath")
        if configured:
            candidate = Path(configured).expanduser()
            if candidate.is_dir():
                return candidate

    default = Path.home() / "workspace/obsidian-vault"
    return default if default.is_dir() else None


def activity_log(vault: Path) -> Path:
    return vault / "_Inbox" / "session-activity-log.md"


def parse_iso(ts: str) -> float | None:
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc).timestamp()
        except Exception:
            continue
    return None


def recent_saves(vault: Path) -> list[tuple[float, str]]:
    """Every individual save recorded in the activity log, oldest first."""
    log = activity_log(vault)
    if not log.is_file():
        return []
    saves: list[tuple[float, str]] = []
    try:
        content = log.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    for line in content.splitlines():
        match = SAVE_LINE_RE.match(line.strip())
        if not match:
            continue
        ts = parse_iso(match.group(1))
        if ts is not None:
            saves.append((ts, match.group(3).strip()))
    saves.sort(key=lambda item: item[0])
    return saves


def saves_since(vault: Path, since: float) -> list[tuple[float, str]]:
    """Saves at or after `since`, with a small grace window for clock skew.

    The activity log timestamp is written by the brain MCP server while `since`
    comes from this process. Both read the same clock, but a save landing in the
    same second as session start should still count.
    """
    return [item for item in recent_saves(vault) if item[0] >= since - CLOCK_SKEW_GRACE]


# --------------------------------------------------------------------------
# Session state
# --------------------------------------------------------------------------
def state_path(workspace: str) -> Path:
    digest = hashlib.sha1(workspace.encode("utf-8")).hexdigest()[:12]
    return Path(tempfile.gettempdir()) / f"brain-guard-{digest}.json"


def load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save_state(path: Path, state: dict) -> None:
    try:
        path.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def workspace_key(payload: dict) -> str:
    for key in ("cwd", "workspaceFolder", "workspace_root", "workspaceRoot"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return os.getcwd()


# --------------------------------------------------------------------------
# Event handlers
# --------------------------------------------------------------------------
def handle_session_start(payload: dict) -> int:
    state_file = state_path(workspace_key(payload))
    save_state(
        state_file,
        {
            "session_start": time.time(),
            "tool_calls": 0,
            "reminders": 0,
            "stop_blocked": False,
        },
    )
    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": PROTOCOL_TEXT,
            }
        }
    )
    return 0


def handle_post_tool_use(payload: dict) -> int:
    state_file = state_path(workspace_key(payload))
    state = load_state(state_file)
    if not state:
        # No SessionStart marker (hook added mid-session) -- start counting now.
        state = {
            "session_start": time.time(),
            "tool_calls": 0,
            "reminders": 0,
            "stop_blocked": False,
        }

    state["tool_calls"] = int(state.get("tool_calls", 0)) + 1
    calls = state["tool_calls"]
    save_state(state_file, state)

    if calls % REMIND_EVERY_CALLS != 0:
        return 0

    vault = vault_path()
    if vault is None:
        return 0

    since = float(state.get("session_start", 0))
    saves = saves_since(vault, since)
    if saves:
        return 0

    state["reminders"] = int(state.get("reminders", 0)) + 1
    save_state(state_file, state)

    elapsed_min = int((time.time() - since) / 60)
    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": clip(
                    f"BRAIN CHECKPOINT DUE: {calls} tool calls and ~{elapsed_min} min "
                    "into this session with no brain save recorded.\n"
                    "Capture the most valuable insight you have right now with "
                    'obsidian_brain: operation="quick_note". Do not wait until the end.\n'
                    + PROTOCOL_TEXT
                ),
            }
        }
    )
    return 0


def handle_pre_compact(payload: dict) -> int:
    state_file = state_path(workspace_key(payload))
    state = load_state(state_file)
    vault = vault_path()

    saved_note = ""
    if vault is not None and state:
        saves = saves_since(vault, float(state.get("session_start", 0)))
        saved_note = f" Brain saves this session: {len(saves)}."

    emit(
        {
            "systemMessage": clip(
                "CONTEXT COMPACTION: preserve only unrecoverable task state."
                + saved_note
                + "\nIf work is incomplete, update PROGRESS.md ## In Progress with "
                "done, next action, and key file.\n"
                "Write one brain checkpoint only when the state is not recoverable "
                "from the repository.\n"
                "Do not commit unless the user explicitly requested a commit."
            )
        }
    )
    return 0


def handle_stop(payload: dict) -> int:
    """Block completion once per session when nothing was saved to the brain.

    `stop_hook_active` is true when the agent is already continuing because a
    previous Stop hook blocked it. Honouring it prevents an infinite loop that
    would burn credits.
    """
    if payload.get("stop_hook_active"):
        return 0

    state_file = state_path(workspace_key(payload))
    state = load_state(state_file)
    if not state or state.get("stop_blocked"):
        return 0

    vault = vault_path()
    if vault is None:
        return 0

    saves = saves_since(vault, float(state.get("session_start", 0)))
    if saves:
        return 0

    state["stop_blocked"] = True
    save_state(state_file, state)

    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "decision": "block",
                "reason": clip(
                    "No brain save was recorded for this session. Before finishing, "
                    'append a summary entry with obsidian_brain: operation="append" '
                    "(or quick_note) covering: context, what was accomplished, key "
                    "findings, files changed, and next steps. This block fires once."
                ),
            }
        }
    )
    return 0


HANDLERS = {
    "SessionStart": handle_session_start,
    "PostToolUse": handle_post_tool_use,
    "PreCompact": handle_pre_compact,
    "Stop": handle_stop,
}


def resolve_event(payload: dict, cli_event: str | None) -> str | None:
    if cli_event:
        return cli_event
    for key in ("hook_event_name", "hookEventName", "event", "eventName"):
        value = payload.get(key)
        if isinstance(value, str) and value in HANDLERS:
            return value
    return None


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------
def self_test() -> int:
    """Exercise the parsing and decision logic against a synthetic vault."""
    failures: list[str] = []

    def check(name: str, condition: bool) -> None:
        if not condition:
            failures.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp)
        (vault / "_Inbox").mkdir(parents=True)
        log = activity_log(vault)
        log.write_text(
            "# Session Activity Log\n\n"
            "- 2026-10-13T02:29:46.482Z append Engineering/old.md\n"
            "- 2026-10-13T03:31:43.580Z append _Inbox/new.md\n"
            "## 2026-10-13T22:54:56.025Z - Checkpoint\n\n"
            "Recent save activity (up to 20):\n"
            "- 2026-10-13T22:46:28.308Z append Engineering/late.md\n",
            encoding="utf-8",
        )

        saves = recent_saves(vault)
        check("parses all save lines", len(saves) == 3)
        check("saves are sorted", [s[0] for s in saves] == sorted(s[0] for s in saves))

        cutoff = parse_iso("2026-10-13T03:00:00Z")
        check("cutoff parses", cutoff is not None)
        check("filters by time", len(saves_since(vault, cutoff)) == 2)

        check("empty vault yields no saves", recent_saves(Path(tmp) / "nope") == [])

        # A session that saved nothing must be detected as unsaved.
        future = parse_iso("2026-10-14T00:00:00Z")
        check("detects unsaved session", saves_since(vault, future) == [])

        # Malformed stdin must not raise.
        check("parse_iso rejects junk", parse_iso("not-a-date") is None)
        check("clip truncates", len(clip("x" * 5000)) <= MAX_MESSAGE_CHARS)

    if failures:
        sys.stderr.write("SELF-TEST FAILURES:\n")
        for name in failures:
            sys.stderr.write(f"  - {name}\n")
        return 1

    sys.stdout.write("brain_guard self-test: all checks passed\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Brain-usage enforcement hook")
    parser.add_argument("--event", help="Hook event name (overrides stdin)")
    parser.add_argument("--self-test", action="store_true", help="Run built-in checks")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    payload = read_stdin_json()
    event = resolve_event(payload, args.event)
    if event is None:
        return 0

    try:
        return HANDLERS[event](payload)
    except Exception:
        # Never fail closed: a broken hook must not wedge the session.
        return 0


if __name__ == "__main__":
    sys.exit(main())
