#!/bin/bash
# Auto-format files after editing with Biome
# Only formats TypeScript, JavaScript, Svelte, and JSON files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
	exit 0
fi

# Check if file type should be formatted
case "$FILE_PATH" in
	*.ts|*.tsx|*.js|*.jsx|*.svelte|*.json)
		if [ -f "$FILE_PATH" ]; then
			cd "$CLAUDE_PROJECT_DIR" || exit 0
			bunx biome format --write "$FILE_PATH" 2>/dev/null
			echo "Formatted: $FILE_PATH"
		fi
		;;
esac

exit 0
