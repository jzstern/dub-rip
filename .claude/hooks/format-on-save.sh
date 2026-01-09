#!/bin/bash
# Auto-format and lint-fix files after editing with Biome
# Only processes TypeScript, JavaScript, Svelte, and JSON files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
	exit 0
fi

# Check if file type should be processed
case "$FILE_PATH" in
	*.ts|*.tsx|*.js|*.jsx|*.svelte|*.json)
		if [ -f "$FILE_PATH" ]; then
			cd "$CLAUDE_PROJECT_DIR" || exit 0
			bunx biome check --write "$FILE_PATH" 2>/dev/null
			echo "Checked: $FILE_PATH"
		fi
		;;
esac

exit 0
