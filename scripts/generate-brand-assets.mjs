import { chromium } from "@playwright/test";

const FONT_IMPORT =
	"@import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap');";

const OG_HTML = `<!doctype html>
<html>
<head>
<style>
${FONT_IMPORT}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
	width: 1200px;
	height: 630px;
	background: #101010;
	color: #f2efe9;
	font-family: 'Familjen Grotesk', sans-serif;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	padding: 72px 80px 64px;
}
h1 {
	font-size: 190px;
	font-weight: 600;
	line-height: 0.9;
	letter-spacing: -0.045em;
	text-transform: lowercase;
}
.artist {
	margin-top: 36px;
	font-family: 'JetBrains Mono', monospace;
	font-size: 22px;
	letter-spacing: 0.14em;
	color: #9d9a91;
}
.bottom {
	border-top: 1px solid rgba(242, 239, 233, 0.3);
	padding-top: 28px;
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
}
.square { width: 40px; height: 40px; background: #b4543a; }
.catalog {
	font-family: 'JetBrains Mono', monospace;
	font-size: 20px;
	letter-spacing: 0.16em;
	color: #9d9a91;
	text-align: right;
}
</style>
</head>
<body>
	<div>
		<h1>dub-rip</h1>
		<p class="artist">youtube &rarr; mp3 &middot; rich metadata</p>
	</div>
	<div class="bottom">
		<span class="square"></span>
		<p class="catalog">DR-001 / STEREO / 44.1kHz</p>
	</div>
</body>
</html>`;

const ICON_HTML = `<!doctype html>
<html>
<head>
<style>
${FONT_IMPORT}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; }
body {
	background: #101010;
	position: relative;
	overflow: hidden;
	font-family: 'Familjen Grotesk', sans-serif;
}
.mark {
	position: absolute;
	left: 6%;
	top: 46%;
	transform: translateY(-50%);
	font-size: 68vh;
	font-weight: 600;
	line-height: 1;
	letter-spacing: -0.07em;
	color: #f2efe9;
}
.square {
	position: absolute;
	right: 9%;
	bottom: 9%;
	width: 17%;
	height: 17%;
	background: #b4543a;
}
</style>
</head>
<body>
	<span class="mark">dr</span>
	<span class="square"></span>
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
