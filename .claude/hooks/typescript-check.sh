#!/bin/bash
# TypeScript Type Checking Hook
# Runs tsc --noEmit after TypeScript file edits to catch type errors early

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
	exit 0
fi

case "$FILE_PATH" in
	*.ts|*.tsx)
		cd "$CLAUDE_PROJECT_DIR" || exit 0

		output=$(bunx tsc --noEmit 2>&1)
		exit_code=$?

		if [ $exit_code -eq 0 ]; then
			echo '{"feedback": "TypeScript: No type errors.", "suppressOutput": true}'
		else
			errors=$(echo "$output" | grep -A 2 "error TS" | head -30)
			if [ -n "$errors" ]; then
				echo "{\"feedback\": \"TypeScript found type errors:\\n$errors\"}" >&2
			fi
		fi
		;;
esac

exit 0
