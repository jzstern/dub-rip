import { chromium } from "@playwright/test";

const ROUNDEL = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
	<circle cx="48" cy="48" r="45" fill="#f4f3f0" stroke="#1d1d1b" stroke-width="2.5"/>
	<circle cx="48" cy="48" r="34" fill="none" stroke="#1d1d1b" stroke-width="1" opacity="0.25"/>
	<circle cx="48" cy="48" r="24" fill="none" stroke="#1d1d1b" stroke-width="1" opacity="0.25"/>
	<line x1="48" y1="14" x2="48" y2="24" stroke="#1d1d1b" stroke-width="1.5" opacity="0.45"/>
	<circle cx="48" cy="48" r="9" fill="#f05e23"/>
</svg>`;

const OG_HTML = `<!doctype html>
<html><head><style>
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&display=swap');
* { margin: 0; box-sizing: border-box; }
body {
	width: 1200px; height: 630px;
	background: #e8e6e1;
	font-family: 'Archivo', sans-serif;
	color: #1d1d1b;
	display: flex; align-items: center; justify-content: center;
}
.panel {
	width: 1060px; height: 480px;
	background: #f4f3f0;
	border: 1px solid #c9c7c0;
	border-radius: 24px;
	padding: 44px 56px;
	display: flex; flex-direction: column; justify-content: space-between;
}
.row { display: flex; justify-content: space-between; }
.silk {
	font-size: 19px; font-weight: 500;
	letter-spacing: 0.16em; text-transform: uppercase;
	color: #6c6a63;
}
.main { display: flex; align-items: center; gap: 64px; padding-left: 8px; }
.word { font-size: 104px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.sub { margin-top: 22px; }
.rule { border-top: 1px solid #d6d4cc; padding-top: 28px; }
</style></head>
<body>
	<div class="panel">
		<div class="row">
			<span class="silk">Dub-rip &middot; Typ 1</span>
			<span class="silk">Audio unit</span>
		</div>
		<div class="main">
			${ROUNDEL(220)}
			<div>
				<div class="word">dub-rip</div>
				<div class="silk sub">Youtube audio &middot; MP3 &middot; ID3 metadata</div>
			</div>
		</div>
		<div class="row rule">
			<span class="silk">Input &middot; Youtube URL</span>
			<span class="silk">Output &middot; MP3</span>
		</div>
	</div>
</body></html>`;

const ICON_HTML = `<!doctype html>
<html><head><style>
* { margin: 0; }
body {
	width: 100vw; height: 100vh;
	background: #e8e6e1;
	display: flex; align-items: center; justify-content: center;
}
svg { width: 78vw; height: 78vw; }
</style></head>
<body>${ROUNDEL(96)}</body></html>`;

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
