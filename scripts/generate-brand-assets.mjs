import { chromium } from "@playwright/test";

const BG = "#0a0e0a";
const GREEN = "#4ade80";
const DIM = "#15803d";
const AMBER = "#f59e0b";
const FONT = "'JetBrains Mono', ui-monospace, monospace";

const FONT_LINK = `
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />`;

const ICON_HTML = `<!doctype html>
<html>
	<head><meta charset="utf-8" />${FONT_LINK}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; }
		body {
			background: ${BG};
			display: flex;
			align-items: center;
			justify-content: center;
			font-family: ${FONT};
		}
		.frame {
			width: 86%;
			height: 86%;
			border: 6px solid ${DIM};
			border-radius: 16%;
			display: flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 0 30px rgba(74, 222, 128, 0.35) inset;
		}
		.prompt {
			color: ${GREEN};
			font-weight: 700;
			font-size: 52vw;
			line-height: 1;
			letter-spacing: -0.04em;
			text-shadow: 0 0 14px rgba(74, 222, 128, 0.7);
		}
	</style></head>
	<body>
		<div class="frame"><span class="prompt">&gt;_</span></div>
	</body>
</html>`;

const OG_HTML = `<!doctype html>
<html>
	<head><meta charset="utf-8" />${FONT_LINK}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			width: 1200px;
			height: 630px;
			background: ${BG};
			font-family: ${FONT};
			display: flex;
			align-items: center;
			justify-content: center;
			background-image: repeating-linear-gradient(
				to bottom,
				rgba(74, 222, 128, 0.05) 0px,
				rgba(74, 222, 128, 0.05) 1px,
				transparent 1px,
				transparent 4px
			);
		}
		.window {
			width: 880px;
			border: 2px solid ${DIM};
			border-radius: 10px;
			overflow: hidden;
			box-shadow: 0 0 60px rgba(74, 222, 128, 0.18);
			background: #0c120c;
		}
		.titlebar {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 14px 18px;
			background: #121a12;
			border-bottom: 1px solid ${DIM};
		}
		.dot { width: 14px; height: 14px; border-radius: 50%; }
		.title { flex: 1; text-align: center; color: #4b8b5a; font-size: 18px; letter-spacing: 0.05em; }
		.body { padding: 40px 44px 48px; }
		.wordmark {
			color: ${GREEN};
			font-weight: 700;
			font-size: 88px;
			letter-spacing: 0.32em;
			text-shadow: 0 0 22px rgba(74, 222, 128, 0.55);
		}
		.line { font-size: 26px; margin-top: 26px; color: #5a9c6a; }
		.line .g { color: ${GREEN}; }
		.amber { color: ${AMBER}; }
		.cursor {
			display: inline-block;
			width: 16px;
			height: 30px;
			background: ${GREEN};
			margin-left: 6px;
			vertical-align: middle;
			box-shadow: 0 0 12px rgba(74, 222, 128, 0.7);
		}
	</style></head>
	<body>
		<div class="window">
			<div class="titlebar">
				<span class="dot" style="background:#d65a52"></span>
				<span class="dot" style="background:#5a6b5a"></span>
				<span class="dot" style="background:#4ade80"></span>
				<span class="title">dub-rip — zsh</span>
				<span style="width:60px"></span>
			</div>
			<div class="body">
				<div class="wordmark">dub-rip</div>
				<div class="line"><span class="g">λ</span> download youtube audio with rich metadata</div>
				<div class="line"><span class="g">λ</span> paste-url <span class="g">❯</span> https://youtube.com/watch?v=<span class="cursor"></span></div>
				<div class="line"><span class="amber">[ok]</span> <span class="g">▸</span> ready</div>
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
