#!/bin/bash
# TypeScript Type Checking Hook
# Runs tsc --noEmit after TypeScript/Svelte file edits to catch type errors early

if ! command -v jq &> /dev/null; then
	exit 0
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
	exit 0
fi

case "$FILE_PATH" in
	*.ts|*.tsx|*.svelte|*.d.ts|tsconfig.json)
		cd "$CLAUDE_PROJECT_DIR" || exit 0

		output=$(bunx tsc --noEmit 2>&1)
		exit_code=$?

		if [ $exit_code -eq 0 ]; then
			echo '{"feedback": "TypeScript: No type errors.", "suppressOutput": true}'
		else
			errors=$(echo "$output" | grep -A 2 "error TS" | head -30)
			if [ -n "$errors" ]; then
				jq -n --arg errors "$errors" '{"feedback": ("TypeScript found type errors:\n" + $errors)}'
			else
				truncated=$(echo "$output" | head -50)
				jq -n --arg output "$truncated" '{"feedback": ("TypeScript check failed:\n" + $output)}'
			fi
		fi
		;;
esac

exit 0
