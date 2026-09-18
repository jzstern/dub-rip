/**
 * yt-dlp 2026.08.19 appends this remediation hint (`_youtube_login_hint`) to
 * every player-response reason containing "sign in" — bot-checks, age gates
 * and private videos alike — so it says nothing about which of them it is.
 */
const YT_DLP_COOKIES_HINT =
	"Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies";

export const AGE_GATE_WITH_COOKIES_HINT = `ERROR: [youtube] abc123: Sign in to confirm your age. This video may be inappropriate for some users. ${YT_DLP_COOKIES_HINT}`;

export const PRIVATE_VIDEO_WITH_COOKIES_HINT = `ERROR: [youtube] abc123: Private video. Sign in if you've been granted access to this video. ${YT_DLP_COOKIES_HINT}`;

// U+2019, not ASCII "'" — the exact apostrophe yt-dlp emits.
export const BOT_CHECK_WITH_COOKIES_HINT = `ERROR: [youtube] abc123: Sign in to confirm you’re not a bot. ${YT_DLP_COOKIES_HINT}`;

/** The bot-check sentence reworded, leaving only the hint to recognise it by. */
export const REWORDED_BOT_CHECK_WITH_COOKIES_HINT = `ERROR: [youtube] abc123: YouTube is asking this session to prove it is human. ${YT_DLP_COOKIES_HINT}`;
