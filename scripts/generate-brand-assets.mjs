import { chromium } from "@playwright/test";

const INK = "#161513";
const PAPER = "#fcfcfa";
const BLUE = "#1f3fff";
const MUTED = "#8a877f";

const VINYL_CHARS = ["─", "━", "═", "~", "≈"];
const GROOVE_CHARS = ["╌", "┄", "╴", "╶"];
const SIZE = 35;
const CENTER = Math.floor(SIZE / 2);
const LABEL_RADIUS = 6.5;
const SPINDLE_RADIUS = 1.7;
const ASPECT_RATIO = 1.6;

function escapeHtml(text) {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function vinylHtml(rotation = 0.6) {
	const lines = [];
	for (let y = 0; y < SIZE; y++) {
		let html = "";
		let run = "";
		let runLabel = false;
		const flush = () => {
			if (!run) return;
			html += runLabel
				? `<span style="color:${BLUE}">${escapeHtml(run)}</span>`
				: escapeHtml(run);
			run = "";
		};
		for (let x = 0; x < SIZE; x++) {
			const dx = x - CENTER;
			const dy = (y - CENTER) * ASPECT_RATIO;
			const distance = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx) + rotation;
			let char = " ";
			let label = false;
			if (distance < SPINDLE_RADIUS) {
				char = "◉";
				label = true;
			} else if (distance < LABEL_RADIUS) {
				char = Math.floor((angle * 2 + distance) % 2) === 0 ? "█" : "▓";
				label = true;
			} else if (distance <= CENTER - 1) {
				const charSet =
					Math.floor(distance) % 2 === 0 ? VINYL_CHARS : GROOVE_CHARS;
				const rawIndex = Math.floor(
					((angle + Math.PI) / (Math.PI * 2)) * charSet.length + distance * 0.5,
				);
				char =
					charSet[
						((rawIndex % charSet.length) + charSet.length) % charSet.length
					];
			} else if (distance <= CENTER) {
				char = "○";
			}
			if (label !== runLabel) {
				flush();
				runLabel = label;
			}
			run += char;
		}
		flush();
		lines.push(html);
	}
	return lines.join("\n");
}

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
`;

const OG_HTML = `<!doctype html>
<html><head><meta charset="utf-8" />${FONT_LINKS}
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		width: 1200px; height: 630px;
		background: ${PAPER}; color: ${INK};
		font-family: "JetBrains Mono", monospace;
		position: relative; overflow: hidden;
	}
	.corner { position: absolute; font-size: 14px; letter-spacing: 0.2em; color: ${MUTED}; }
	.tl { top: 32px; left: 40px; }
	.tr { top: 32px; right: 40px; }
	.bl { bottom: 32px; left: 40px; }
	.br { bottom: 32px; right: 40px; }
	.col {
		position: absolute; left: 80px; top: 50%; transform: translateY(-50%);
		max-width: 480px;
	}
	.wordmark { font-size: 26px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
	.rule { width: 64px; height: 2px; background: ${INK}; margin: 28px 0; }
	.stat { font-size: 20px; letter-spacing: 0.15em; color: ${MUTED}; margin-bottom: 16px; }
	.desc { font-size: 22px; line-height: 1.5; }
	.vinyl {
		position: absolute; right: 96px; top: 50%; transform: translateY(-50%);
		font-size: 19px; line-height: 16px; color: ${INK}; white-space: pre;
	}
</style></head>
<body>
	<span class="corner tl">A1</span>
	<span class="corner tr">DUB-RIP / 01</span>
	<span class="corner bl">⌀ 300MM</span>
	<span class="corner br">33⅓ RPM</span>
	<div class="col">
		<div class="wordmark">dub-rip</div>
		<div class="rule"></div>
		<div class="stat">[ 33⅓ / MP3 / ID3v2 ]</div>
		<div class="desc">Download YouTube audio with rich metadata</div>
	</div>
	<pre class="vinyl">${vinylHtml()}</pre>
</body></html>`;

const ICON_HTML = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
	* { margin: 0; padding: 0; }
	body { width: 100vw; height: 100vh; background: ${PAPER}; }
	svg { display: block; width: 100%; height: 100%; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
	<rect width="64" height="64" fill="${PAPER}"/>
	<g fill="none" stroke="${INK}" stroke-linecap="round">
		<circle cx="32" cy="32" r="27" stroke-width="2.5" stroke-dasharray="3 3.4"/>
		<circle cx="32" cy="32" r="21" stroke-width="2" stroke-dasharray="2 4.2"/>
		<circle cx="32" cy="32" r="15" stroke-width="2" stroke-dasharray="4.5 3.2"/>
	</g>
	<circle cx="32" cy="32" r="8.5" fill="${BLUE}"/>
	<circle cx="32" cy="32" r="2.2" fill="${PAPER}"/>
</svg>
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
