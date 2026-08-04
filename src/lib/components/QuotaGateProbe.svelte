<script lang="ts">
interface Props {
	label?: string;
}

let { label = "probe" }: Props = $props();
let ticks = $state(0);
</script>

<div class="probe">
	<span>{label}</span>
	<button type="button" onclick={() => ticks++}>
		ticked {ticks}
	</button>
</div>

<style>
	.probe {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
</style>
