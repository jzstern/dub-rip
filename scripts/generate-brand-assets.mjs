import { chromium } from "@playwright/test";

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">`;

const DISC = `
<div class="disc">
	<div class="rim"></div>
	<div class="chrome"></div>
	<div class="grooves"></div>
	<div class="label"></div>
	<div class="spindle"></div>
	<div class="shine"></div>
</div>`;

const BASE_STYLE = `
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body { width: 100%; height: 100%; }
	body {
		display: flex; align-items: center; justify-content: center;
		background:
			radial-gradient(ellipse 120% 80% at 50% -10%, rgba(232,121,249,0.18), transparent 55%),
			radial-gradient(ellipse 100% 70% at 50% 115%, rgba(34,211,238,0.22), transparent 60%),
			#0b1020;
		font-family: "Orbitron", sans-serif;
		overflow: hidden;
	}
	.disc { position: relative; }
	.rim {
		position: absolute; inset: 0; border-radius: 50%;
		background: linear-gradient(135deg, #22d3ee, #e879f9);
		filter: blur(2px);
	}
	.chrome {
		position: absolute; inset: 7%; border-radius: 50%;
		background: conic-gradient(from 220deg, #22d3ee, #e8f6fb 25%, #8aa1b8 45%, #e879f9 60%, #cbe7f2 80%, #22d3ee);
		box-shadow: inset 0 0 24px rgba(11,16,32,0.4);
	}
	.grooves {
		position: absolute; inset: 10%; border-radius: 50%;
		background: repeating-radial-gradient(circle, transparent 0 5px, rgba(11,16,32,0.18) 5px 6px);
	}
	.label {
		position: absolute; inset: 38%; border-radius: 50%;
		background: #0b1020;
		border: 2px solid; border-image: linear-gradient(135deg, #22d3ee, #e879f9) 1;
		box-shadow: 0 0 18px rgba(34,211,238,0.5);
	}
	.spindle {
		position: absolute; top: 50%; left: 50%; width: 8%; height: 8%;
		transform: translate(-50%, -50%); border-radius: 50%;
		background: #22d3ee; box-shadow: 0 0 8px #22d3ee;
	}
	.shine {
		position: absolute; top: 16%; left: 18%; width: 34%; height: 18%;
		border-radius: 50%; background: rgba(255,255,255,0.4);
		filter: blur(6px); transform: rotate(-40deg);
	}`;

const ICON_HTML = `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
	${BASE_STYLE}
	.disc { width: 84%; aspect-ratio: 1; }
</style></head><body>${DISC}</body></html>`;

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
	${BASE_STYLE}
	body { flex-direction: row; gap: 72px; position: relative; }
	body::before {
		content: ""; position: absolute; inset: 0; z-index: 0;
		background-image:
			repeating-linear-gradient(to right, rgba(34,211,238,0.22) 0 1px, transparent 1px 64px),
			repeating-linear-gradient(to bottom, rgba(34,211,238,0.16) 0 1px, transparent 1px 64px);
		mask-image: linear-gradient(to bottom, transparent 50%, black 100%);
		-webkit-mask-image: linear-gradient(to bottom, transparent 50%, black 100%);
		transform: perspective(600px) rotateX(60deg);
		transform-origin: bottom center;
	}
	.disc { width: 300px; height: 300px; z-index: 1; filter: drop-shadow(0 0 40px rgba(34,211,238,0.4)); }
	.wordmark { z-index: 1; }
	.title {
		font-weight: 900; font-size: 132px; letter-spacing: 0.12em; text-transform: uppercase;
		background: linear-gradient(175deg, #22d3ee 0%, #ffffff 32%, #8aa1b8 52%, #ffffff 70%, #e879f9 100%);
		-webkit-background-clip: text; background-clip: text; color: transparent;
		filter: drop-shadow(0 0 24px rgba(34,211,238,0.35));
	}
	.tagline {
		font-family: "JetBrains Mono", monospace; font-size: 26px; letter-spacing: 0.28em;
		text-transform: uppercase; color: #7dd3e8; margin-top: 18px;
	}
</style></head><body>${DISC}<div class="wordmark"><div class="title">dub-rip</div><div class="tagline">YouTube audio · rich metadata</div></div></body></html>`;

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
