<script lang="ts">
import { Progress as ProgressPrimitive } from "bits-ui";
import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	max = 100,
	value,
	...restProps
}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

let remainder = $derived(100 - (100 * (value ?? 0)) / (max ?? 1));
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn("vu-track", className)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="vu-fill"
		style="transform: translateX(-{remainder}%)"
	></div>
	<div class="vu-peak" style="transform: translateX(-{remainder}%)"></div>
</ProgressPrimitive.Root>
