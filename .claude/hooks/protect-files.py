#!/usr/bin/env python3
"""
PreToolUse hook that blocks edits to protected files.
Receives JSON via stdin with 'tool_input.file_path', exits 2 to block.
"""
import json
import sys

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, EOFError):
    sys.exit(0)

path = data.get("tool_input", {}).get("file_path", "")
blocked = [".env", "bun.lock", ".git/", "node_modules/"]

if any(b in path for b in blocked):
    print(f"Blocked: Cannot modify protected file: {path}", file=sys.stderr)
    sys.exit(2)

sys.exit(0)
