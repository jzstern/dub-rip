export function parseYtDlpError(
	errorMessage: string,
	poTokenAvailable = true,
): string {
	const lowerMessage = errorMessage.toLowerCase();
	if (
		lowerMessage.includes("sign in to confirm you're not a bot") ||
		lowerMessage.includes("cookies")
	) {
		if (!poTokenAvailable) {
			return "Download service is temporarily unavailable (anti-bot token missing). Please try again in a few minutes.";
		}
		return "This video requires authentication. Please try a different video or try again later.";
	}
	if (lowerMessage.includes("video unavailable")) {
		return "This video is unavailable or private.";
	}
	if (
		lowerMessage.includes("age-restricted") ||
		lowerMessage.includes("confirm your age") ||
		lowerMessage.includes("verify your age")
	) {
		return "This video is age-restricted and cannot be downloaded.";
	}
	if (lowerMessage.includes("copyright")) {
		return "This video is blocked due to copyright restrictions.";
	}
	if (lowerMessage.includes("private")) {
		return "This video is private and cannot be downloaded.";
	}
	return "Download failed. Please try a different video.";
}
