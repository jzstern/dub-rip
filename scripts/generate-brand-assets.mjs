import { chromium } from "@playwright/test";

const BG = "#191817";
const BONE = "#e6e1d8";
const MUTED = "#8d877c";
const AMBER = "#e8a33c";
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const GROOVES = ["-", "~", "="];
const RIM = ["o", "0", "O"];

function renderDisc({
	rows,
	cols,
	radius,
	aspect,
	hub,
	label,
	grooveInset = 1.6,
	rimInset = 0.5,
	phase = 0,
}) {
	const cy = (rows - 1) / 2;
	const cx = (cols - 1) / 2;
	let html = "";
	let inLabel = false;

	const push = (ch, isLabel) => {
		if (isLabel !== inLabel) {
			html += isLabel ? "<b>" : "</b>";
			inLabel = isLabel;
		}
		html += ch;
	};

	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const nx = x - cx;
			const ny = (y - cy) * aspect;
			const r = Math.hypot(nx, ny);
			const a = Math.atan2(ny, nx) + phase;

			if (r <= hub) {
				push("·", true);
			} else if (r <= label) {
				push(Math.floor(a / 0.9 + 64) % 2 === 0 ? "@" : "#", true);
			} else if (r <= radius - grooveInset) {
				const ring = Math.floor(r);
				const seg = Math.floor(a / 0.5 + 128);
				push(GROOVES[(seg + ring) % GROOVES.length], false);
			} else if (r <= radius - rimInset) {
				const seg = Math.floor(a / 0.5 + 128);
				push(RIM[seg % RIM.length], false);
			} else if (r <= radius + 0.15) {
				push(".", false);
			} else {
				push(" ", false);
			}
		}
		push("\n", false);
	}
	if (inLabel) html += "</b>";
	return html;
}

const SITE_DISC = renderDisc({
	rows: 13,
	cols: 27,
	radius: 11.4,
	aspect: 2.05,
	hub: 1,
	label: 3.5,
});

const MARK_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
	<rect width="100" height="100" fill="${BG}"/>
	<circle cx="50" cy="50" r="35" fill="none" stroke="${BONE}" stroke-opacity="0.28" stroke-width="2.5"/>
	<circle cx="50" cy="50" r="18" fill="${AMBER}"/>
</svg>
`;

const ICON_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:${BG}}
</style></head><body>${MARK_SVG}</body></html>`;

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;background:${BG};color:${BONE};font-family:${MONO};overflow:hidden}
.wrap{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding-left:96px}
.rule{width:64px;height:3px;background:${AMBER};margin-bottom:38px}
.wordmark{font-size:74px;font-weight:600;letter-spacing:0.3em;white-space:nowrap}
.tag{margin-top:30px;font-size:19px;letter-spacing:0.26em;color:${MUTED}}
.spec{margin-top:76px;font-size:15px;letter-spacing:0.14em;color:${AMBER}}
pre.disc{position:absolute;top:50%;right:-268px;transform:translateY(-50%);font-size:40px;line-height:1.12;letter-spacing:0.06em;white-space:pre;color:${MUTED}}
pre.disc b{color:${AMBER}}
</style></head><body>
<div class="wrap">
	<pre class="disc">${SITE_DISC}</pre>
	<div class="rule"></div>
	<div class="wordmark">DUB.RIP</div>
	<div class="tag">DOWNLOAD AUDIO W/ RICH METADATA</div>
	<div class="spec">MP3 128 kbps</div>
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
