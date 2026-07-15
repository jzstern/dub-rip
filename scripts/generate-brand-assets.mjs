import { chromium } from "@playwright/test";

const LABEL_SVG = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
	<circle cx="16" cy="16" r="15.5" fill="#211a12"/>
	<circle cx="16" cy="16" r="13.5" fill="none" stroke="#3a3025" stroke-width="0.6"/>
	<circle cx="16" cy="16" r="11.5" fill="none" stroke="#3a3025" stroke-width="0.6"/>
	<circle cx="16" cy="16" r="9.75" fill="none" stroke="#3a3025" stroke-width="0.6"/>
	<circle cx="16" cy="16" r="8" fill="#c8871a"/>
	<circle cx="16" cy="16" r="8" fill="none" stroke="#211a12" stroke-width="0.8"/>
	<circle cx="16" cy="16" r="5.4" fill="none" stroke="#211a12" stroke-width="0.5" opacity="0.55"/>
	<circle cx="16" cy="16" r="2.6" fill="#f3ead8"/>
	<circle cx="16" cy="16" r="2.6" fill="none" stroke="#211a12" stroke-width="0.7"/>
</svg>`;

const ICON_HTML = `<!doctype html>
<html><head><style>
	html, body { margin: 0; padding: 0; }
	body { width: 100vw; height: 100vh; display: grid; place-items: center; background: #f3ead8; }
	svg { width: 100%; height: 100%; }
</style></head>
<body>${LABEL_SVG(180)}</body></html>`;

const OG_HTML = `<!doctype html>
<html><head>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
<style>
	html, body { margin: 0; padding: 0; }
	body {
		width: 1200px; height: 630px;
		background: #f3ead8; color: #211a12;
		display: flex; align-items: center; justify-content: center; gap: 72px;
		font-family: "JetBrains Mono", monospace;
		position: relative;
	}
	.frame { position: absolute; inset: 20px; border: 2px solid #211a12; }
	.corner { position: absolute; font-size: 16px; letter-spacing: 0.2em; color: #5a4c38; }
	.tl { top: 32px; left: 40px; }
	.tr { top: 32px; right: 40px; }
	.bl { bottom: 32px; left: 40px; }
	.br { bottom: 32px; right: 40px; }
	.disc { width: 380px; height: 380px; flex: none; }
	.disc svg { width: 100%; height: 100%; }
	.wordmark { display: flex; flex-direction: column; gap: 18px; }
	.matrix { font-size: 18px; letter-spacing: 0.35em; color: #5a4c38; }
	h1 {
		margin: 0;
		font-family: "Archivo Black", sans-serif;
		font-size: 110px; line-height: 1;
		letter-spacing: -0.02em; text-transform: uppercase;
	}
	h1 sup { font-family: "JetBrains Mono", monospace; font-size: 24px; letter-spacing: 0; }
	.caption { font-size: 22px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: #c8871a; }
	.tagline { font-size: 18px; letter-spacing: 0.05em; color: #5a4c38; }
</style></head>
<body>
	<div class="frame"></div>
	<span class="corner tl">45</span>
	<span class="corner tr">&#8471; 2026</span>
	<span class="corner bl">DR-45-001</span>
	<span class="corner br">STEREO</span>
	<div class="disc">${LABEL_SVG(380)}</div>
	<div class="wordmark">
		<span class="matrix">DR-45-001 &middot; SIDE A &middot; 45 RPM</span>
		<h1>dub-rip<sup>&reg;</sup></h1>
		<span class="caption">A dub plate special</span>
		<span class="tagline">Download YouTube audio with rich metadata</span>
	</div>
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
