<script lang="ts">
import type {
	HTMLInputAttributes,
	HTMLInputTypeAttribute,
} from "svelte/elements";
import { cn, type WithElementRef } from "$lib/utils.js";

type InputType = Exclude<HTMLInputTypeAttribute, "file">;

type Props = WithElementRef<
	Omit<HTMLInputAttributes, "type"> &
		(
			| { type: "file"; files?: FileList }
			| { type?: InputType; files?: undefined }
		)
>;

let {
	ref = $bindable(null),
	value = $bindable(),
	type,
	files = $bindable(),
	class: className,
	"data-slot": dataSlot = "input",
	...restProps
}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"selection:bg-primary dark:bg-input/30 selection:text-primary-foreground border-input ring-offset-background placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 pt-1.5 text-sm font-medium shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
			"focus-visible:border-ring focus-visible:ring-0",
			"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"border-input bg-background selection:bg-primary selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground/70 flex h-9 w-full min-w-0 rounded-sm border px-3 py-1 font-mono text-base tracking-tight shadow-none transition-[color,box-shadow,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
			"focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_12px_hsl(var(--phosphor)/0.3)]",
			"aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
