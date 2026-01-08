<script lang="ts">
import type { PlaylistInfo } from "$lib/types";

interface Props {
	playlist: PlaylistInfo;
	downloadPlaylist: boolean;
	onToggle: (checked: boolean) => void;
}

let {
	playlist,
	downloadPlaylist = $bindable(false),
	onToggle,
}: Props = $props();
</script>

<div class="p-3 rounded-md border bg-muted/50 space-y-2">
	<div class="flex items-center justify-between">
		<div class="space-y-0.5">
			<p class="text-sm font-medium">Playlist: {playlist.title}</p>
			<p class="text-xs text-muted-foreground">
				{playlist.count} videos • {playlist.uploader}
			</p>
		</div>
	</div>
	<label class="flex items-center gap-2 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={downloadPlaylist}
			class="w-4 h-4 rounded border-input"
		/>
		<span class="text-sm">Download entire playlist ({playlist.count} videos)</span>
	</label>
</div>
