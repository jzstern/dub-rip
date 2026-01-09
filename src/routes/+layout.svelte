<script lang="ts">
import "../app.css";
import { onMount } from "svelte";

const { children } = $props();

onMount(() => {
	// Listen for system theme changes (initial theme is set by blocking script in app.html)
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
