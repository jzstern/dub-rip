# Generate Tests

Generate comprehensive tests for the codebase.

## Instructions

1. **Analyze existing code** to understand what needs testing:
   - API routes in `src/routes/api/`
   - Utility functions in `src/lib/`
   - Components in `src/lib/components/`

2. **Create unit tests** using Vitest (SvelteKit's default):

### For API Routes
```typescript
// tests/api/preview.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('Preview API', () => {
	it('should reject invalid URLs', async () => {
		// Test implementation
	});

	it('should handle private videos gracefully', async () => {
		// Test implementation
	});
});
```

### For Utility Functions
```typescript
// tests/lib/utils.test.ts
import { describe, it, expect } from 'vitest';
import { parseVideoTitle, formatDuration } from '$lib/utils';

describe('parseVideoTitle', () => {
	it('should extract artist and title from "Artist - Title" format', () => {
		// Test implementation
	});
});
```

### For Components
```typescript
// tests/components/VideoPreview.test.ts
import { render, screen } from '@testing-library/svelte';
import VideoPreview from '$lib/components/VideoPreview.svelte';

describe('VideoPreview', () => {
	it('should display video title', () => {
		// Test implementation
	});
});
```

3. **Test categories to cover**:
   - Happy path (valid inputs)
   - Error cases (invalid URLs, network failures)
   - Edge cases (empty strings, special characters)
   - Security cases (path traversal attempts, XSS payloads)

4. **Add test script to package.json** if not present:
```json
"scripts": {
	"test": "vitest",
	"test:run": "vitest run",
	"test:coverage": "vitest run --coverage"
}
```

5. **Install test dependencies** if needed:
```bash
bun add -d vitest @testing-library/svelte @testing-library/jest-dom jsdom
```

6. **Create vitest.config.ts** if not present.

7. **Output**: Create test files and report what was generated.
