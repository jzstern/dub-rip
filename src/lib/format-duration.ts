const SECONDS_PER_HOUR = 3600;

export function formatDuration(seconds: number): string {
	if (!seconds) return "";

	const totalSeconds = Math.floor(seconds);
	const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
	const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / 60);
	const secs = totalSeconds % 60;
	const paddedSecs = secs.toString().padStart(2, "0");

	if (hours > 0) {
		const paddedMinutes = minutes.toString().padStart(2, "0");
		return `${hours}:${paddedMinutes}:${paddedSecs}`;
	}

	return `${minutes}:${paddedSecs}`;
}
