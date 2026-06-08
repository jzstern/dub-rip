import { chromium } from "@playwright/test";

const FONT_LINK = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
`;

const MARK = (size) => `
	<svg viewBox="0 0 120 120" width="${size}" height="${size}">
		<circle cx="60" cy="60" r="58" fill="none" stroke="#0a0a0a" stroke-width="4" />
		<circle cx="60" cy="60" r="46" fill="none" stroke="#0a0a0a" stroke-width="2.5" />
		<circle cx="60" cy="60" r="36" fill="none" stroke="#0a0a0a" stroke-width="2.5" />
		<circle cx="60" cy="60" r="22" fill="#ff3b00" />
		<rect x="58" y="2" width="4" height="20" fill="#ff3b00" />
		<circle cx="60" cy="60" r="4" fill="#ffffff" />
	</svg>
`;

const ICON_HTML = `<!doctype html>
<html>
	<head><meta charset="utf-8" />${FONT_LINK}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; }
		body { display: flex; align-items: center; justify-content: center; background: #ffffff; }
		.frame { width: 90%; height: 90%; display: flex; align-items: center; justify-content: center; }
		svg { width: 86%; height: 86%; }
	</style>
	</head>
	<body><div class="frame">${MARK(120)}</div></body>
</html>`;

const OG_HTML = `<!doctype html>
<html>
	<head><meta charset="utf-8" />${FONT_LINK}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 1200px; height: 630px; }
		body {
			background: #ffffff;
			color: #0a0a0a;
			font-family: "Space Grotesk", sans-serif;
			display: flex;
			flex-direction: column;
			position: relative;
		}
		.topbar {
			border-bottom: 4px solid #0a0a0a;
			padding: 22px 56px;
			font-family: "JetBrains Mono", monospace;
			font-size: 22px;
			letter-spacing: 0.25em;
			text-transform: uppercase;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.accent { color: #ff3b00; }
		.body {
			flex: 1;
			display: flex;
			align-items: center;
			gap: 56px;
			padding: 0 56px;
		}
		.mark svg { width: 260px; height: 260px; }
		.wordmark {
			font-size: 240px;
			font-weight: 700;
			line-height: 0.82;
			letter-spacing: -0.05em;
		}
		.tagline {
			margin-top: 26px;
			font-family: "JetBrains Mono", monospace;
			font-size: 26px;
			letter-spacing: 0.04em;
			color: #383838;
			text-transform: uppercase;
		}
		.bottombar {
			border-top: 4px solid #0a0a0a;
			padding: 22px 56px;
			font-family: "JetBrains Mono", monospace;
			font-size: 22px;
			letter-spacing: 0.25em;
			text-transform: uppercase;
			color: #383838;
		}
	</style>
	</head>
	<body>
		<div class="topbar"><span>YouTube &rarr; MP3</span><span class="accent">&#9679;&nbsp;Audio Ripper</span></div>
		<div class="body">
			<div class="mark">${MARK(260)}</div>
			<div>
				<div class="wordmark">dub<span class="accent">-</span>rip</div>
				<div class="tagline">Download YouTube audio with rich metadata</div>
			</div>
		</div>
		<div class="bottombar">No ads / No tracking / Just audio</div>
	</body>
</html>`;

const shots = [
	{ html: OG_HTML, w: 1200, h: 630, out: "static/og-image.png" },
	{ html: ICON_HTML, w: 180, h: 180, out: "static/apple-touch-icon.png" },
	{ html: ICON_HTML, w: 32, h: 32, out: "static/favicon-32x32.png" },
	{ html: ICON_HTML, w: 16, h: 16, out: "static/favicon-16x16.png" },
];

const b = await chromium.launch();
for (const s of shots) {
	const p = await b.newPage({
		viewport: { width: s.w, height: s.h },
		deviceScaleFactor: 1,
	});
	await p.setContent(s.html, { waitUntil: "networkidle" });
	await p.evaluate(() => document.fonts.ready);
	await p.screenshot({ path: s.out });
	await p.close();
}
await b.close();
console.log("BRAND_OK");
