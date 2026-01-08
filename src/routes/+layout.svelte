<script lang="ts">
import "../app.css";
import { onMount } from "svelte";

const { children } = $props();

onMount(() => {
	// Check system theme preference
	const prefersDark =
		window.matchMedia &&
		(window.matchMedia("(prefers-color-scheme: dark)").matches ||
			!window.matchMedia("(prefers-color-scheme: light)").matches);

	// Apply dark mode by default or based on system preference
	if (prefersDark) {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}

	// Listen for system theme changes
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleChange = (e: MediaQueryListEvent) => {
		if (e.matches) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	};

	mediaQuery.addEventListener("change", handleChange);
	return () => mediaQuery.removeEventListener("change", handleChange);
});
</script>

{@render children()}
