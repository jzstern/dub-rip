# Svelte 5 Patterns for dub-rip

Full code templates for SvelteKit 5 development in this project.

## Component Structure Template

```svelte
<script lang="ts">
// 1. Imports
import { Component } from 'package';
import type { TypeOnly } from 'package';

// 2. Types/Interfaces
interface Props {
	title: string;
	optional?: boolean;
}

// 3. Props
let { title, optional = false }: Props = $props();

// 4. State
let loading = $state(false);

// 5. Functions
function handleClick() {
	// ...
}

// 6. Effects
$effect(() => {
	// ...
});
</script>

<!-- Template -->
<!-- Styles (if any) -->
```

## Svelte 5 Runes Examples

```svelte
<!-- State -->
let count = $state(0);
let user = $state<User | null>(null);

<!-- Props with defaults -->
let { title, onClick, disabled = false }: Props = $props();

<!-- Derived state -->
let doubled = $derived(count * 2);

<!-- Effects -->
$effect(() => {
	console.log('count changed:', count);
});

<!-- Effect with cleanup -->
$effect(() => {
	const interval = setInterval(() => count++, 1000);
	return () => clearInterval(interval);
});
```

## shadcn-svelte Imports

```typescript
// Single component
import { Button } from "$lib/components/ui/button";

// Compound components (Card, Dialog, etc.)
import * as Card from "$lib/components/ui/card";
// Usage: <Card.Root>, <Card.Header>, <Card.Content>

// bits-ui components (underlying primitives)
import { Progress } from "bits-ui";
// NOT: import type { Progress } from "bits-ui"
```

## Error Handling Templates

### Server-Side (API Routes)
```typescript
try {
	// ... operation
} catch (error: any) {
	// 1. Log full details to console
	console.error("Operation error details:", {
		message: error.message,
		stderr: error.stderr,
		stdout: error.stdout,
		stack: error.stack,
	});

	// 2. Parse for user-friendly messages
	let userMessage = "Operation failed";
	if (error.stderr?.includes("specific error")) {
		userMessage = "User-friendly explanation";
	}

	// 3. Return clean error
	return json({ error: userMessage }, { status: 500 });
}
```

### Client-Side (Svelte)
```typescript
try {
	// ... operation
} catch (err) {
	console.error("Client error:", err);
	error = err instanceof Error ? err.message : "Operation failed";
}
```

## Integration with Other Skills
- **testing-patterns**: Test all UI states (loading, error, empty, success)
- **svelte-code-writer**: Use CLI tools for documentation lookup
- **code-reviewer**: Validate against project standards after implementation
