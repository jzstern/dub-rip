import { chromium } from "@playwright/test";

const FONTS = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
`;

const ICON_HTML = `<!doctype html>
<html><head>${FONTS}<style>
	* { margin: 0; box-sizing: border-box; }
	body { width: 100vw; height: 100vh; background: #dcdcd7; }
	.shell {
		width: 100%; height: 100%; border-radius: 22%;
		background: #dcdcd7;
		border: 3px solid rgba(22, 22, 22, 0.2);
		position: relative;
	}
	.grille {
		position: absolute; top: 19%; left: 50%; transform: translateX(-50%);
		width: 50%; height: 8%;
		background-image: radial-gradient(rgba(22, 22, 22, 0.55) 28%, transparent 34%);
		background-size: 20% 100%;
	}
	.button {
		position: absolute; top: 58%; left: 50%; transform: translate(-50%, -50%);
		width: 46%; height: 46%; border-radius: 50%;
		background: #ff4d00;
		border: 2px solid rgba(22, 22, 22, 0.25);
	}
</style></head>
<body><div class="shell"><div class="grille"></div><div class="button"></div></div></body></html>`;

const OG_HTML = `<!doctype html>
<html><head>${FONTS}<style>
	* { margin: 0; box-sizing: border-box; }
	body {
		width: 1200px; height: 630px;
		background: #dcdcd7;
		display: flex; align-items: center; justify-content: center;
		font-family: "Space Grotesk", sans-serif;
		color: #161616;
	}
	.device {
		width: 640px;
		border-radius: 28px;
		background-color: #ebebe7;
		background-image: radial-gradient(rgba(22, 22, 22, 0.05) 1.5px, transparent 2px);
		background-size: 14px 14px;
		border: 2px solid rgba(22, 22, 22, 0.15);
		padding: 44px 48px 52px;
		position: relative;
	}
	.screw {
		position: absolute; width: 11px; height: 11px; border-radius: 50%;
		border: 1.5px solid rgba(22, 22, 22, 0.3);
	}
	.screw::after {
		content: ""; position: absolute; left: 1px; right: 1px; top: 50%;
		height: 1.5px; background: rgba(22, 22, 22, 0.3); transform: rotate(45deg);
	}
	.screw.tl { top: 14px; left: 14px; }
	.screw.tr { top: 14px; right: 14px; }
	.screw.bl { bottom: 14px; left: 14px; }
	.screw.br { bottom: 14px; right: 14px; }
	h1 {
		font-family: "JetBrains Mono", monospace;
		font-size: 56px; font-weight: 700; letter-spacing: 0.25em;
	}
	.label {
		font-family: "JetBrains Mono", monospace;
		font-size: 17px; letter-spacing: 0.3em; text-transform: uppercase;
		color: rgba(22, 22, 22, 0.55);
		margin-top: 14px;
	}
	.row { display: flex; align-items: center; justify-content: space-between; }
	.button {
		width: 130px; height: 130px; border-radius: 50%;
		background: #ff4d00;
		box-shadow: 0 0 0 8px rgba(22, 22, 22, 0.08), 0 6px 0 #ad3400;
		display: flex; align-items: center; justify-content: center;
		color: #fff;
		font-family: "JetBrains Mono", monospace;
		font-size: 24px; font-weight: 700; letter-spacing: 0.15em;
	}
	.grille {
		height: 22px; margin: 40px 0;
		background-image: radial-gradient(rgba(22, 22, 22, 0.3) 2px, transparent 2.8px);
		background-size: 12px 12px;
		background-position: center;
	}
	.led { width: 8px; height: 8px; border-radius: 50%; background: #2f9e44; display: inline-block; margin-right: 12px; }
</style></head>
<body>
	<div class="device">
		<span class="screw tl"></span><span class="screw tr"></span>
		<span class="screw bl"></span><span class="screw br"></span>
		<div class="row">
			<div>
				<h1>DUB–RIP</h1>
				<p class="label"><span class="led"></span>Audio extractor</p>
			</div>
			<div class="button">GET</div>
		</div>
		<div class="grille"></div>
		<p class="label">YouTube → MP3 · Rich metadata</p>
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
