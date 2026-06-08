import { chromium } from "@playwright/test";

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`;

const CASSETTE_SVG = `<svg viewBox="0 0 232 116" fill="none" xmlns="http://www.w3.org/2000/svg" class="reels">
	<line x1="62" y1="42" x2="170" y2="42" stroke="#26211d" stroke-width="11" stroke-linecap="round"/>
	<g>
		<circle cx="62" cy="58" r="32" fill="#26211d"/>
		<circle cx="62" cy="58" r="32" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.65"/>
		<g fill="#3a332d">
			<rect x="59.5" y="28" width="5" height="20" rx="2.5"/>
			<rect x="59.5" y="28" width="5" height="20" rx="2.5" transform="rotate(60 62 58)"/>
			<rect x="59.5" y="28" width="5" height="20" rx="2.5" transform="rotate(120 62 58)"/>
			<rect x="59.5" y="28" width="5" height="20" rx="2.5" transform="rotate(180 62 58)"/>
			<rect x="59.5" y="28" width="5" height="20" rx="2.5" transform="rotate(240 62 58)"/>
			<rect x="59.5" y="28" width="5" height="20" rx="2.5" transform="rotate(300 62 58)"/>
		</g>
		<circle cx="62" cy="58" r="9" fill="#3a332d"/>
		<circle cx="62" cy="58" r="3.5" fill="#f59e0b"/>
	</g>
	<g>
		<circle cx="170" cy="58" r="32" fill="#26211d"/>
		<circle cx="170" cy="58" r="32" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.65"/>
		<g fill="#3a332d">
			<rect x="167.5" y="28" width="5" height="20" rx="2.5"/>
			<rect x="167.5" y="28" width="5" height="20" rx="2.5" transform="rotate(60 170 58)"/>
			<rect x="167.5" y="28" width="5" height="20" rx="2.5" transform="rotate(120 170 58)"/>
			<rect x="167.5" y="28" width="5" height="20" rx="2.5" transform="rotate(180 170 58)"/>
			<rect x="167.5" y="28" width="5" height="20" rx="2.5" transform="rotate(240 170 58)"/>
			<rect x="167.5" y="28" width="5" height="20" rx="2.5" transform="rotate(300 170 58)"/>
		</g>
		<circle cx="170" cy="58" r="9" fill="#3a332d"/>
		<circle cx="170" cy="58" r="3.5" fill="#f59e0b"/>
	</g>
</svg>`;

const ICON_HTML = `<!doctype html><html><head><style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body { width: 100%; height: 100%; }
	body { display: flex; align-items: center; justify-content: center;
		background: #1c1917; }
	.icon { width: 90%; height: 90%; border-radius: 19%;
		background: linear-gradient(160deg, #26211d, #1c1917);
		border: 4px solid #f59e0b;
		display: flex; align-items: center; justify-content: center;
		position: relative; overflow: hidden;
		box-shadow: inset 0 0 24px rgba(0,0,0,0.5); }
	.cass { width: 70%; height: 44%; border-radius: 10%;
		background: #211c19; position: relative;
		display: flex; align-items: center; justify-content: center;
		gap: 14%; }
	.reel { width: 30%; aspect-ratio: 1; border-radius: 50%;
		border: 8% solid #faf7f0; box-sizing: border-box;
		display: flex; align-items: center; justify-content: center;
		background:
			radial-gradient(circle, #f59e0b 22%, transparent 23%),
			repeating-conic-gradient(#3a332d 0deg 30deg, #211c19 30deg 60deg); }
	.bar { position: absolute; bottom: 8%; width: 52%; height: 9%;
		border-radius: 999px; background: #dc2626; }
</style></head><body><div class="icon">
	<div class="cass"><div class="reel"></div><div class="reel"></div></div>
	<div class="bar"></div>
</div></body></html>`;

const OG_HTML = `<!doctype html><html><head>${FONT_LINK}<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body { width: 1200px; height: 630px; }
	body { font-family: 'Space Grotesk', sans-serif;
		background:
			radial-gradient(ellipse at 50% -10%, rgba(245,158,11,0.16), transparent 55%),
			#1c1917;
		color: #faf7f0; position: relative;
		display: flex; flex-direction: column;
		align-items: center; justify-content: center; overflow: hidden; }
	body::after { content: ''; position: absolute; inset: 0;
		background-image:
			repeating-linear-gradient(90deg, rgba(250,247,240,0.04) 0 1px, transparent 1px 9px);
		mask-image: linear-gradient(180deg, transparent, #000 78%);
		opacity: 0.5; }
	.frame { position: absolute; inset: 36px; border: 1px solid rgba(245,158,11,0.35);
		border-radius: 22px; }
	.reels { width: 360px; height: 180px; margin-bottom: 12px; filter: drop-shadow(0 10px 24px rgba(0,0,0,0.5)); }
	.wordmark { font-size: 150px; font-weight: 700; letter-spacing: -0.05em; line-height: 0.9; }
	.wordmark .dot { color: #f59e0b; }
	.tag { margin-top: 22px; font-family: 'JetBrains Mono', monospace;
		font-size: 26px; letter-spacing: 0.34em; text-transform: uppercase;
		color: rgba(250,247,240,0.62); }
	.led { position: absolute; top: 70px; right: 78px; width: 16px; height: 16px;
		border-radius: 50%; background: #f59e0b; box-shadow: 0 0 18px #f59e0b; }
</style></head><body>
	<div class="frame"></div>
	<div class="led"></div>
	${CASSETTE_SVG}
	<div class="wordmark">dub<span class="dot">·</span>rip</div>
	<div class="tag">YouTube &rarr; warm tagged MP3s</div>
</body></html>`;

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
