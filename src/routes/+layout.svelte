<script lang="ts">
import "../app.css";
import { onMount } from "svelte";
import { page } from "$app/state";

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

<svelte:head>
	<meta property="og:type" content="website" />
	<meta property="og:title" content="dub-rip" />
	<meta property="og:description" content="YouTube audio, pressed to MP3 with proper metadata" />
	<meta property="og:image" content="{page.url.origin}/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="dub-rip - YouTube audio, pressed to MP3 with proper metadata" />
	<meta property="og:site_name" content="dub-rip" />
	<meta property="og:url" content="{page.url.href}" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="dub-rip" />
	<meta name="twitter:description" content="YouTube audio, pressed to MP3 with proper metadata" />
	<meta name="twitter:image" content="{page.url.origin}/og-image.png" />
	<meta name="twitter:image:alt" content="dub-rip - YouTube audio, pressed to MP3 with proper metadata" />
</svelte:head>

{@render children()}
