#!/usr/bin/env python3
"""
UserPromptSubmit hook that suggests relevant commands based on prompt keywords.
Receives JSON via stdin with 'prompt' field, outputs plain text hints to stdout.
"""
import json
import sys

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, EOFError):
    # No input or invalid JSON - exit silently
    sys.exit(0)

prompt = data.get("prompt", "").lower()
context_hints = []

if any(word in prompt for word in ["test", "e2e", "playwright"]):
    context_hints.append("Consider running /e2e for full E2E test suite")

if any(word in prompt for word in ["review", "pr", "check"]):
    context_hints.append("Consider running /review for comprehensive code review")

if any(word in prompt for word in ["security", "vuln", "safe"]):
    context_hints.append("Consider running /security for security audit")

if context_hints:
    print(" | ".join(context_hints))
