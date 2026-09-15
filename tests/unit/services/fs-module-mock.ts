import { createRequire } from "node:module";

/**
 * Builds the module object a `vi.mock("node:fs", …)` factory must return.
 *
 * `importOriginal()` hands back an empty namespace for node builtins under this
 * Vite config, which leaves `fs.constants` undefined and fails the executable
 * check in `isExecutable` for a reason unrelated to whatever is under test.
 * CommonJS resolution sidesteps the module graph and returns the genuine module.
 *
 * Call this from inside the factory body rather than passing it as the factory:
 * `vi.mock` is hoisted above imports, so evaluating this binding eagerly would
 * hit its temporal dead zone.
 */
export function fsModuleWith(
	overrides: Record<string, unknown>,
): Record<string, unknown> {
	const realFs = createRequire(import.meta.url)("node:fs");
	return { ...realFs, ...overrides, default: { ...realFs, ...overrides } };
}
