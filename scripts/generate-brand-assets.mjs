import { chromium } from "@playwright/test";

const FONT_LINK = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
`;

const ICON_HTML = `<!doctype html>
<html><head>${FONT_LINK}
<style>
	* { margin: 0; box-sizing: border-box; }
	body {
		width: 100vw; height: 100vh;
		background: #e9e9e6;
		display: grid; place-items: center;
		font-family: "JetBrains Mono", monospace;
	}
	.stub {
		width: 78vw; height: 84vh;
		background: #fdfdfb;
		border: 4.5vw solid #000;
		border-bottom: 0;
		clip-path: polygon(
			0 0, 100% 0, 100% 88%,
			93.75% 100%, 87.5% 88%, 81.25% 100%, 75% 88%,
			68.75% 100%, 62.5% 88%, 56.25% 100%, 50% 88%,
			43.75% 100%, 37.5% 88%, 31.25% 100%, 25% 88%,
			18.75% 100%, 12.5% 88%, 6.25% 100%, 0 88%
		);
		display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		gap: 6vh;
	}
	.dr { font-size: 30vw; font-weight: 700; color: #000; line-height: 1; }
	.dot { width: 13vw; height: 13vw; border-radius: 50%; background: #c92a1e; }
</style></head>
<body><div class="stub"><div class="dr">DR</div><div class="dot"></div></div></body></html>`;

const OG_HTML = `<!doctype html>
<html><head>${FONT_LINK}
<style>
	* { margin: 0; box-sizing: border-box; }
	body {
		width: 1200px; height: 630px;
		background: #161617;
		display: grid; place-items: center;
		font-family: "JetBrains Mono", monospace;
		overflow: hidden;
	}
	.receipt-wrap {
		transform: rotate(-2deg);
		filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)) drop-shadow(0 24px 48px rgba(0,0,0,0.55));
	}
	.edge { height: 12px; background-repeat: repeat-x; background-size: 18px 12px; }
	.edge.top {
		background-image:
			linear-gradient(-45deg, #fdfdfb 6px, transparent 0),
			linear-gradient(45deg, #fdfdfb 6px, transparent 0);
		background-position: bottom left;
	}
	.edge.bottom {
		background-image:
			linear-gradient(-135deg, #fdfdfb 6px, transparent 0),
			linear-gradient(135deg, #fdfdfb 6px, transparent 0);
		background-position: top left;
	}
	.receipt {
		width: 420px; background: #fdfdfb; color: #000;
		padding: 34px 30px; position: relative;
	}
	.center { text-align: center; }
	.disc { font-size: 22px; line-height: 1; }
	h1 { font-size: 21px; letter-spacing: 0.15em; margin-top: 6px; }
	.sub { font-size: 12px; color: #444; text-transform: uppercase; margin-top: 6px; }
	hr { border: 0; border-top: 2px dashed rgba(0,0,0,0.55); margin: 18px 0; }
	.line {
		display: flex; justify-content: space-between; gap: 12px;
		font-size: 14px; text-transform: uppercase; line-height: 2;
		white-space: nowrap;
	}
	.line .dots { flex: 1; overflow: hidden; color: rgba(0,0,0,0.45); }
	.bar { font-size: 14px; letter-spacing: 2px; }
	.stamp {
		position: absolute; right: 26px; bottom: 118px;
		border: 4px solid #c92a1e; color: #c92a1e;
		font-size: 24px; font-weight: 700; letter-spacing: 0.25em;
		padding: 8px 18px; text-transform: uppercase;
		transform: rotate(-8deg);
	}
	.barcode {
		height: 44px; margin-top: 4px;
		background: repeating-linear-gradient(90deg,
			#000 0 3px, transparent 3px 6px, #000 6px 8px, transparent 8px 12px,
			#000 12px 17px, transparent 17px 20px, #000 20px 22px, transparent 22px 27px);
	}
	.code { font-size: 13px; letter-spacing: 0.3em; margin-top: 8px; }
</style></head>
<body>
	<div class="receipt-wrap">
		<div class="edge top"></div>
		<div class="receipt">
			<div class="center">
				<div class="disc">◉</div>
				<h1>** DUB-RIP RECORDS **</h1>
				<div class="sub">YouTube audio · rich metadata</div>
			</div>
			<hr />
			<div class="line"><span>Paste URL</span><span class="dots">..................................</span><span>&gt;</span></div>
			<div class="line"><span>MP3 Audio</span><span class="dots">..................................</span><span>OK</span></div>
			<div class="line"><span>ID3 Tags</span><span class="dots">..................................</span><span>OK</span></div>
			<div class="line"><span>Cover Art</span><span class="dots">..................................</span><span>OK</span></div>
			<div class="line bar"><span>■■■■■■■■■■ 100%</span></div>
			<hr />
			<div class="center">
				<div class="barcode"></div>
				<div class="code">*DR-2025*</div>
			</div>
			<div class="stamp">✂ Saved</div>
		</div>
		<div class="edge bottom"></div>
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
