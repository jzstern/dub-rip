import { chromium } from "@playwright/test";

const FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
`;

const MARK_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
	<rect x="1" y="1" width="62" height="62" rx="12" fill="#191817" stroke="#000000" stroke-width="2"/>
	<path d="M16 3.5 H48" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5" stroke-linecap="round"/>
	<g stroke="#8d877c" stroke-width="2" stroke-linecap="round">
		<line x1="14.5" y1="30" x2="17" y2="34"/>
		<line x1="23" y1="22.5" x2="25" y2="26.8"/>
		<line x1="34" y1="19.5" x2="34.6" y2="24.2"/>
		<line x1="45" y1="22.5" x2="43" y2="26.8"/>
		<line x1="53.5" y1="30" x2="51" y2="34"/>
	</g>
	<line x1="32" y1="46" x2="45" y2="24" stroke="#e8a33c" stroke-width="3.5" stroke-linecap="round"/>
	<circle cx="32" cy="46" r="4" fill="#e8a33c"/>
	<rect x="14" y="53" width="22" height="3" rx="1.5" fill="#e8a33c"/>
	<rect x="38" y="53" width="12" height="3" rx="1.5" fill="#3a3735"/>
</svg>
`;

const ICON_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#191817}
</style></head><body>${MARK_SVG}</body></html>`;

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;background:#191817;font-family:'Inter Tight',sans-serif;color:#e6e1d8;overflow:hidden}
.wrap{display:flex;align-items:center;justify-content:center;gap:88px;height:100%}
.strip{width:340px;background:#211f1e;border:1px solid #35322f;border-radius:8px;box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.04),0 1px 0 #000}
.section{padding:26px 28px;border-top:1px solid rgb(141 135 124 / 0.18)}
.section:first-child{border-top:none}
.label{font-size:13px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#8d877c;margin-bottom:16px}
.well{height:48px;background:#141312;border:1px solid #35322f;border-radius:5px;box-shadow:inset 0 1px 2px rgb(0 0 0 / 0.35);display:flex;align-items:center;padding:0 16px;color:#8d877c;font-size:15px}
.key{margin-top:12px;height:48px;background:#2a2725;border:1px solid #35322f;border-radius:5px;box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.04),0 1px 0 #000;display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase}
.key .dot{color:#e8a33c;font-size:10px}
.track{position:relative;height:12px;background:#141312;border:1px solid #35322f;border-radius:3px;box-shadow:inset 0 1px 2px rgb(0 0 0 / 0.35);overflow:hidden}
.fill{position:absolute;inset:0;right:38%;background:#e8a33c}
.peak{position:absolute;top:0;bottom:0;left:70%;width:2px;background:#e8a33c}
.ticks{display:flex;justify-content:space-between;margin-top:7px;padding:0 1px}
.ticks i{display:block;width:1px;height:4px;background:rgb(141 135 124 / 0.45)}
.ticks i.M{height:7px;background:rgb(141 135 124 / 0.75)}
.nums{display:flex;justify-content:space-between;margin-top:6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#8d877c}
.readout{margin-top:16px;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:13px;color:#8d877c}
.readout .pct{color:#e8a33c}
.side{max-width:520px}
.wordmark{font-size:88px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;line-height:1}
.tag{margin-top:28px;font-size:22px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#8d877c}
.spec{margin-top:44px;font-family:'JetBrains Mono',monospace;font-size:18px;color:#8d877c}
.spec b{color:#e8a33c;font-weight:500}
</style></head><body>
<div class="wrap">
	<div class="strip">
		<div class="section">
			<div class="label">Input</div>
			<div class="well">Paste YouTube URL</div>
			<div class="key"><span class="dot">&#9679;</span> Download</div>
		</div>
		<div class="section">
			<div class="label">Level</div>
			<div class="track"><div class="fill"></div><div class="peak"></div></div>
			<div class="ticks"><i class="M"></i><i></i><i></i><i></i><i></i><i class="M"></i><i></i><i></i><i></i><i></i><i class="M"></i><i></i><i></i><i></i><i></i><i class="M"></i><i></i><i></i><i></i><i></i><i class="M"></i></div>
			<div class="nums"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
			<div class="readout"><span>Downloading&hellip;</span><span class="pct">62%</span></div>
		</div>
	</div>
	<div class="side">
		<div class="wordmark">DUB.RIP</div>
		<div class="tag">YouTube audio &middot; rich metadata</div>
		<div class="spec">SRC YOUTUBE &rarr; <b>MP3 128 kbps &middot; ID3v2</b></div>
	</div>
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
