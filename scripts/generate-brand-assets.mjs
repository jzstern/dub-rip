import { chromium } from "@playwright/test";

const FONTS = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
`;

const OG_HTML = `<!doctype html>
<html>
<head>
${FONTS}
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		width: 1200px; height: 630px;
		background: #faf8f2; color: #1a1a18;
		font-family: Georgia, "Times New Roman", serif;
		display: flex; align-items: center; justify-content: center;
	}
	.page { width: 1080px; text-align: center; }
	.rule-heavy { height: 5px; background: #1a1a18; }
	.rule-hair { height: 1px; background: #1a1a18; }
	.rule-mid { height: 1px; background: #c9c4b6; }
	.masthead {
		font-family: "Playfair Display", Georgia, serif;
		font-weight: 900; font-size: 128px; line-height: 1;
		letter-spacing: -0.02em; margin: 28px 0 18px;
	}
	.caps { text-transform: uppercase; font-weight: 700; letter-spacing: 0.2em; font-size: 17px; }
	.dateline { padding: 10px 0; }
	.headline {
		font-family: "Playfair Display", Georgia, serif;
		font-weight: 700; font-size: 44px; letter-spacing: 0.01em;
		margin: 34px 0 14px;
	}
	.deck { font-style: italic; font-size: 21px; color: #55534a; }
	.slug { color: #9e2b25; margin-top: 30px; font-size: 14px; }
	.gap { height: 3px; }
</style>
</head>
<body>
	<div class="page">
		<div class="rule-heavy"></div>
		<div class="gap"></div>
		<div class="rule-hair"></div>
		<h1 class="masthead">Dub&#8212;Rip</h1>
		<div class="rule-hair"></div>
		<p class="caps dateline">Vol. I &#183; No. 1 &#8212; Audio Edition &#8212; Free</p>
		<div class="rule-hair"></div>
		<h2 class="headline caps" style="letter-spacing:0.08em;">Youtube Audio, Properly Tagged</h2>
		<p class="deck">Every recording typeset with artist, title, artwork &amp; duration.</p>
		<p class="caps slug">The Download Desk &#8212; Printed on Demand</p>
	</div>
</body>
</html>`;

const ICON_HTML = `<!doctype html>
<html>
<head>
${FONTS}
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		width: 100vw; height: 100vh;
		background: #faf8f2; color: #1a1a18;
		display: flex; align-items: center; justify-content: center;
	}
	.frame {
		width: 88vmin; height: 88vmin;
		border: 2.5vmin solid #1a1a18;
		display: flex; align-items: center; justify-content: center;
	}
	.monogram {
		font-family: "Playfair Display", Georgia, serif;
		font-weight: 900; font-size: 34vmin; line-height: 1;
		white-space: nowrap; padding-bottom: 4vmin;
	}
	.dash { color: #9e2b25; }
</style>
</head>
<body>
	<div class="frame">
		<div class="monogram">D<span class="dash">&#8211;</span>R</div>
	</div>
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
