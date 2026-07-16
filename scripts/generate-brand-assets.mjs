import { chromium } from "@playwright/test";

const PAPER = "#f7f4ee";
const INK = "#22201c";
const HAIRLINE = "#d8d2c4";
const RED = "#b3261e";
const RED_DEEP = "#8e1e18";
const MUTED = "#6b6659";

const FONTS = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet" />
`;

const SEAL_SVG = (size) => `
	<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
		<circle cx="16" cy="16" r="11" fill="${RED}"/>
		<circle cx="16" cy="16" r="8.75" fill="none" stroke="${RED_DEEP}" stroke-width="0.6"/>
		<circle cx="16" cy="16" r="6.75" fill="none" stroke="${RED_DEEP}" stroke-width="0.6"/>
		<circle cx="16" cy="16" r="4.75" fill="none" stroke="${RED_DEEP}" stroke-width="0.6"/>
		<circle cx="16" cy="16" r="1.6" fill="${PAPER}"/>
	</svg>
`;

const OG_HTML = `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	${FONTS}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			width: 1200px;
			height: 630px;
			background: ${PAPER};
			color: ${INK};
			font-family: "Newsreader", Georgia, serif;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.sheet {
			width: 1104px;
			height: 534px;
			border: 1px solid ${HAIRLINE};
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
		}
		.label {
			font-family: "JetBrains Mono", monospace;
			font-size: 15px;
			letter-spacing: 0.18em;
			text-transform: uppercase;
			color: ${MUTED};
			position: absolute;
		}
		.tl { top: 28px; left: 32px; }
		.tr { top: 28px; right: 32px; }
		.bl { bottom: 28px; left: 32px; }
		.br { bottom: 28px; right: 32px; }
		h1 {
			font-size: 128px;
			font-weight: 500;
			letter-spacing: -0.02em;
			line-height: 1;
			margin-top: 36px;
		}
		h1 .dash { color: ${RED}; }
		.rule {
			width: 72px;
			height: 2px;
			background: ${RED};
			margin-top: 28px;
		}
		.tagline {
			margin-top: 26px;
			font-style: italic;
			font-size: 30px;
			color: ${MUTED};
		}
	</style>
</head>
<body>
	<div class="sheet">
		<span class="label tl">Side A</span>
		<span class="label tr">33&#8531; rpm &middot; stereo</span>
		<span class="label bl">&#8470; 001</span>
		<span class="label br">Est. 2025</span>
		${SEAL_SVG(120)}
		<h1>dub<span class="dash">-</span>rip</h1>
		<div class="rule"></div>
		<p class="tagline">YouTube audio, pressed to MP3 with proper metadata</p>
	</div>
</body>
</html>`;

const ICON_HTML = `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<style>
		* { margin: 0; padding: 0; }
		html, body { width: 100%; height: 100%; }
		body { background: ${PAPER}; display: flex; align-items: center; justify-content: center; }
		svg { width: 100%; height: 100%; display: block; }
	</style>
</head>
<body>
	${SEAL_SVG(180).replace('width="180" height="180"', 'width="100%" height="100%"')}
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
	const p = await b.newPage({ viewport: { width: s.w, height: s.h } });
	await p.setContent(s.html, { waitUntil: "networkidle" });
	await p.evaluate(() => document.fonts.ready);
	await p.screenshot({ path: s.out });
	await p.close();
}
await b.close();
console.log("BRAND_OK");
