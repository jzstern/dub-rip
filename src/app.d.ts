// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** Inlined by Vite's `define` — see `vite.config.ts`. Empty when unset. */
	const __RAILWAY_ENVIRONMENT_NAME__: string;
	const __RAILWAY_COMMIT_SHA__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
