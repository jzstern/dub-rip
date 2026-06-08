import { chromium } from "@playwright/test";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');`;

const ICON_HTML = `<!doctype html>
<html>
	<head><style>
		${FONT_IMPORT}
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; }
		body {
			display: flex; align-items: center; justify-content: center;
			background:
				radial-gradient(120% 120% at 20% 10%, #4c1d95 0%, transparent 55%),
				radial-gradient(120% 120% at 90% 90%, #831843 0%, transparent 55%),
				#1e1b4b;
		}
		.disc {
			position: relative;
			width: 72%; height: 72%;
			border-radius: 9999px;
			background: radial-gradient(circle at 38% 30%, #f0abfc 0%, #a78bfa 42%, #4c1d95 100%);
			box-shadow:
				0 0 60px 10px rgba(167,139,250,0.65),
				inset 0 0 30px -6px rgba(255,255,255,0.6),
				inset 0 -14px 40px -12px rgba(76,29,149,0.9);
		}
		.disc::before {
			content: ""; position: absolute; inset: 33%;
			border-radius: 9999px;
			background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(103,232,249,0.55) 60%, rgba(103,232,249,0) 100%);
		}
		.disc::after {
			content: ""; position: absolute; left: 50%; top: 50%;
			width: 9%; height: 9%; transform: translate(-50%, -50%);
			border-radius: 9999px; background: #fff;
			box-shadow: 0 0 10px 3px rgba(255,255,255,0.7);
		}
	</style></head>
	<body><div class="disc"></div></body>
</html>`;

const OG_HTML = `<!doctype html>
<html>
	<head><style>
		${FONT_IMPORT}
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 1200px; height: 630px; font-family: 'Plus Jakarta Sans', sans-serif; }
		body {
			display: flex; align-items: center; justify-content: center;
			background:
				radial-gradient(90% 120% at 8% 6%, #1e1b4b 0%, transparent 55%),
				radial-gradient(90% 120% at 96% 18%, #4c1d95 0%, transparent 55%),
				radial-gradient(120% 130% at 50% 110%, #831843 0%, transparent 60%),
				#1e1b4b;
			position: relative; overflow: hidden;
		}
		.orb { position: absolute; border-radius: 9999px; filter: blur(90px); }
		.orb-a { width: 460px; height: 460px; top: -120px; left: -80px; background: rgba(167,139,250,0.55); }
		.orb-b { width: 420px; height: 420px; bottom: -140px; right: -60px; background: rgba(240,171,252,0.45); }
		.orb-c { width: 320px; height: 320px; top: 200px; right: 280px; background: rgba(103,232,249,0.35); }
		.card {
			position: relative; z-index: 1;
			display: flex; align-items: center; gap: 56px;
			padding: 64px 88px;
			border-radius: 40px;
			background: rgba(255,255,255,0.08);
			backdrop-filter: blur(28px);
			border: 1px solid rgba(255,255,255,0.18);
			box-shadow: 0 40px 120px -30px rgba(76,29,149,0.7), inset 0 1px 0 0 rgba(255,255,255,0.25);
		}
		.disc {
			position: relative; width: 220px; height: 220px; flex: none;
			border-radius: 9999px;
			background: radial-gradient(circle at 38% 30%, #f0abfc 0%, #a78bfa 42%, #4c1d95 100%);
			box-shadow: 0 0 80px 14px rgba(167,139,250,0.7), inset 0 0 40px -8px rgba(255,255,255,0.6), inset 0 -18px 50px -14px rgba(76,29,149,0.9);
		}
		.disc::before { content: ""; position: absolute; inset: 33%; border-radius: 9999px; background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(103,232,249,0.55) 60%, rgba(103,232,249,0) 100%); }
		.disc::after { content: ""; position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; transform: translate(-50%,-50%); border-radius: 9999px; background: #fff; box-shadow: 0 0 14px 4px rgba(255,255,255,0.7); }
		.copy { display: flex; flex-direction: column; gap: 14px; }
		.title {
			font-size: 112px; font-weight: 800; letter-spacing: -3px; line-height: 1;
			background: linear-gradient(100deg, #a78bfa 0%, #f0abfc 50%, #67e8f9 100%);
			-webkit-background-clip: text; background-clip: text; color: transparent;
		}
		.sub { font-size: 30px; font-weight: 500; color: rgba(255,255,255,0.82); letter-spacing: 0.2px; }
	</style></head>
	<body>
		<div class="orb orb-a"></div><div class="orb orb-b"></div><div class="orb orb-c"></div>
		<div class="card">
			<div class="disc"></div>
			<div class="copy">
				<div class="title">dub-rip</div>
				<div class="sub">Download YouTube audio with rich metadata</div>
			</div>
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
