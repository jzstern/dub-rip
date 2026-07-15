import { chromium } from "@playwright/test";

const mark = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
	<circle cx="16" cy="16" r="14" fill="#1a1a1a"/>
	<circle cx="16" cy="16" r="11" fill="none" stroke="#fafafa" stroke-width="0.75" opacity="0.3"/>
	<circle cx="16" cy="16" r="8.5" fill="none" stroke="#fafafa" stroke-width="0.75" opacity="0.3"/>
	<circle cx="16" cy="16" r="5" fill="#fafafa"/>
	<circle cx="16" cy="16" r="1.5" fill="#1a1a1a"/>
</svg>`;

const ICON_HTML = `<!doctype html>
<html><head><style>
	* { margin: 0; }
	body {
		width: 100vw; height: 100vh;
		display: flex; align-items: center; justify-content: center;
		background: #fafafa;
	}
	svg { width: 72%; height: 72%; }
</style></head>
<body>${mark(32)}</body></html>`;

const OG_HTML = `<!doctype html>
<html><head><style>
	* { margin: 0; }
	body {
		width: 1200px; height: 630px;
		display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		gap: 36px;
		background: #fafafa;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}
	.wordmark {
		font-size: 28px; font-weight: 500;
		letter-spacing: -0.01em; color: #1a1a1a;
	}
	.tagline {
		font-size: 16px; font-weight: 400;
		color: #737373; margin-top: -24px;
	}
	svg { width: 88px; height: 88px; }
</style></head>
<body>
	${mark(88)}
	<div class="wordmark">dub-rip</div>
	<div class="tagline">Download YouTube audio with rich metadata</div>
</body></html>`;

const shots = [
	{ html: OG_HTML, w: 1200, h: 630, out: "static/og-image.png" },
	{ html: ICON_HTML, w: 180, h: 180, out: "static/apple-touch-icon.png" },
	{ html: ICON_HTML, w: 32, h: 32, out: "static/favicon-32x32.png" },
	{ html: ICON_HTML, w: 16, h: 16, out: "static/favicon-16x16.png" },
];

const b = await chromium.launch();
for (const s of shots) {
	const p = await b.newPage({ viewport: { width: s.w, height: s.h } });
	await p.setContent(s.html, { waitUntil: "networkidle" });
	await p.evaluate(() => document.fonts.ready);
	await p.screenshot({ path: s.out });
	await p.close();
}
await b.close();
console.log("BRAND_OK");
