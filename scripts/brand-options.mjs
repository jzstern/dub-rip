import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const OUT =
	"/private/tmp/claude-501/-Users-jzs-GIT-dub-rip/1068e4d7-9303-4c45-968d-8a361d7fa06c/scratchpad/brand";

const BG = "#191817";
const PANEL = "#211f1e";
const BONE = "#e6e1d8";
const MUTED = "#8d877c";
const AMBER = "#e8a33c";
const BORDER = "#2a2928";
const INK = "#211909";
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

const ICON_DISC = renderDisc({
	rows: 7,
	cols: 11,
	radius: 5,
	aspect: 1.667,
	hub: 0.9,
	label: 2,
	grooveInset: 1.2,
	rimInset: 0.4,
});

const page = (css, body) =>
	`<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:${BG};color:${BONE};font-family:${MONO};overflow:hidden}
${css}</style></head><body>${body}</body></html>`;

const svgIcon = (inner) =>
	page(
		"svg{display:block;width:100%;height:100%}",
		`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${BG}"/>${inner}</svg>`,
	);

const FAVICONS = [
	{
		slug: "ascii-disc",
		html: page(
			`body{display:flex;align-items:center;justify-content:center}
pre{font-size:13vmin;line-height:1;letter-spacing:0;font-weight:700;color:${BONE};white-space:pre}
b{color:${AMBER};font-weight:700}`,
			`<pre>${ICON_DISC}</pre>`,
		),
	},
	{
		slug: "amber-label",
		html: svgIcon(`
<circle cx="50" cy="50" r="46" fill="#232120"/>
<circle cx="50" cy="50" r="46" fill="none" stroke="${BONE}" stroke-opacity="0.12" stroke-width="1.5"/>
<circle cx="50" cy="50" r="38" fill="none" stroke="${BONE}" stroke-opacity="0.75" stroke-width="3"/>
<circle cx="50" cy="50" r="25" fill="${AMBER}"/>
<circle cx="50" cy="50" r="5" fill="${BG}"/>`),
	},
	{
		slug: "monogram",
		html: svgIcon(`
<text x="26" y="50" text-anchor="middle" dominant-baseline="central" font-family='${MONO}' font-size="56" font-weight="600" fill="${BONE}">D</text>
<text x="74" y="50" text-anchor="middle" dominant-baseline="central" font-family='${MONO}' font-size="56" font-weight="600" fill="${BONE}">R</text>
<circle cx="50" cy="70" r="7" fill="${AMBER}"/>`),
	},
	{
		slug: "groove-rings",
		html: svgIcon(`
<circle cx="50" cy="50" r="45" fill="none" stroke="${BONE}" stroke-opacity="0.22" stroke-width="2.5"/>
<circle cx="50" cy="50" r="35" fill="none" stroke="${BONE}" stroke-opacity="0.5" stroke-width="3"/>
<circle cx="50" cy="50" r="24" fill="none" stroke="${AMBER}" stroke-width="4.5"/>
<circle cx="50" cy="50" r="13" fill="none" stroke="${BONE}" stroke-opacity="0.4" stroke-width="3"/>
<circle cx="50" cy="50" r="3.5" fill="${BONE}" fill-opacity="0.75"/>`),
	},
	{
		slug: "dot-rip",
		html: svgIcon(`
<circle cx="50" cy="50" r="35" fill="none" stroke="${BONE}" stroke-opacity="0.28" stroke-width="2.5"/>
<circle cx="50" cy="50" r="18" fill="${AMBER}"/>`),
	},
];

const OG_BASE = `
body{width:1200px;height:630px}
.wordmark{font-weight:600;color:${BONE};white-space:nowrap}
.tag{color:${MUTED}}
pre.disc{color:${MUTED};line-height:1.12;letter-spacing:0.06em;white-space:pre}
pre.disc b{color:${AMBER}}`;

const OGS = [
	{
		slug: "hero-ascii",
		html: page(
			`${OG_BASE}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px}
pre.disc{font-size:27px}
.wordmark{font-size:46px;letter-spacing:0.42em;text-indent:0.42em}
.tag{margin-top:18px;font-size:15px;letter-spacing:0.24em;text-indent:0.24em}
.head{display:flex;flex-direction:column;align-items:center}`,
			`<div class="wrap">
	<pre class="disc">${SITE_DISC}</pre>
	<div class="head">
		<div class="wordmark">DUB.RIP</div>
		<div class="tag">DOWNLOAD AUDIO W/ RICH METADATA</div>
	</div>
</div>`,
		),
	},
	{
		slug: "left-type",
		html: page(
			`${OG_BASE}
.wrap{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding-left:96px}
.rule{width:64px;height:3px;background:${AMBER};margin-bottom:38px}
.wordmark{font-size:74px;letter-spacing:0.3em;text-indent:0.3em}
.tag{margin-top:30px;font-size:19px;letter-spacing:0.26em;text-indent:0.26em}
.spec{margin-top:76px;font-size:15px;color:${MUTED};letter-spacing:0.14em}
.spec b{color:${AMBER};font-weight:400}
pre.disc{position:absolute;top:50%;right:-268px;transform:translateY(-50%);font-size:40px}`,
			`<div class="wrap">
	<pre class="disc">${SITE_DISC}</pre>
	<div class="rule"></div>
	<div class="wordmark">DUB.RIP</div>
	<div class="tag">DOWNLOAD AUDIO W/ RICH METADATA</div>
	<div class="spec">SRC YOUTUBE &rarr; <b>MP3 128 kbps &middot; ID3v2</b></div>
</div>`,
		),
	},
	{
		slug: "panel",
		html: page(
			`${OG_BASE}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px}
.wordmark{font-size:34px;letter-spacing:0.42em;text-indent:0.42em}
.tag{margin-top:14px;font-size:12.5px;letter-spacing:0.24em;text-indent:0.24em}
.head{display:flex;flex-direction:column;align-items:center}
.panel{width:560px;background:${PANEL};border:1px solid ${BORDER};border-radius:12px;box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.04),0 1px 0 rgb(0 0 0 / 0.45),0 18px 42px rgb(0 0 0 / 0.32)}
.body{padding:26px;display:flex;flex-direction:column;gap:18px}
.well{height:58px;background:${BG};border:1px solid ${BORDER};border-radius:7px;box-shadow:inset 0 1px 2px rgb(0 0 0 / 0.35);display:flex;align-items:center;padding:0 18px;color:${MUTED};font-size:16px}
.btn{height:58px;background:${AMBER};border-radius:7px;display:flex;align-items:center;justify-content:center;color:${INK};font-size:15px;font-weight:700;letter-spacing:0.14em}
.meta{display:flex;align-items:center;gap:14px;padding:2px 2px 0}
.thumb{width:64px;height:44px;border-radius:4px;background:#141312;border:1px solid ${BORDER}}
.lines{display:flex;flex-direction:column;gap:8px}
.l1{width:250px;height:9px;border-radius:2px;background:rgb(230 225 216 / 0.28)}
.l2{width:150px;height:8px;border-radius:2px;background:rgb(141 135 124 / 0.35)}
.foot{display:flex;justify-content:flex-end;border-top:1px solid ${BORDER};padding:12px 26px;font-size:12px;letter-spacing:0.12em;color:${MUTED}}`,
			`<div class="wrap">
	<div class="head">
		<div class="wordmark">DUB.RIP</div>
		<div class="tag">DOWNLOAD AUDIO W/ RICH METADATA</div>
	</div>
	<div class="panel">
		<div class="body">
			<div class="well">Paste a YouTube link</div>
			<div class="btn">DOWNLOAD</div>
			<div class="meta">
				<div class="thumb"></div>
				<div class="lines"><div class="l1"></div><div class="l2"></div></div>
			</div>
		</div>
		<div class="foot">MP3 128 kbps &middot; ID3v2</div>
	</div>
</div>`,
		),
	},
	{
		slug: "minimal",
		html: page(
			`${OG_BASE}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:60px}
.wordmark{font-size:104px;letter-spacing:0.52em;text-indent:0.52em}
.rule{width:190px;height:2px;background:${AMBER}}`,
			`<div class="wrap">
	<div class="wordmark">DUB.RIP</div>
	<div class="rule"></div>
</div>`,
		),
	},
	{
		slug: "spec-strip",
		html: page(
			`${OG_BASE}
.wrap{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:104px}
.wordmark{font-size:68px;letter-spacing:0.38em;text-indent:0.38em}
.tag{margin-top:28px;font-size:16px;letter-spacing:0.26em;text-indent:0.26em}
.strip{position:absolute;left:0;right:0;bottom:0;height:104px;background:${PANEL};border-top:1px solid ${BORDER};display:flex;align-items:center;justify-content:space-between;padding:0 64px;font-size:17px;letter-spacing:0.1em}
.strip .left{display:flex;align-items:center;gap:16px;color:${BONE}}
.dot{width:11px;height:11px;background:${AMBER};border-radius:50%}
.strip .right{color:${MUTED};letter-spacing:0.18em;font-size:14px}
.prog{position:absolute;left:0;bottom:0;width:38%;height:3px;background:${AMBER}}
.ticks{position:absolute;left:64px;right:64px;top:0;display:flex;justify-content:space-between}
.ticks i{display:block;width:1px;height:6px;background:rgb(141 135 124 / 0.4)}
.ticks i.m{height:11px;background:rgb(141 135 124 / 0.7)}`,
			`<div class="wrap">
	<div class="wordmark">DUB.RIP</div>
	<div class="tag">DOWNLOAD AUDIO W/ RICH METADATA</div>
</div>
<div class="strip">
	<div class="ticks">${Array.from({ length: 21 }, (_, i) => `<i class="${i % 5 === 0 ? "m" : ""}"></i>`).join("")}</div>
	<div class="left"><span class="dot"></span>MP3 128 kbps &middot; ID3v2</div>
	<div class="right">SRC YOUTUBE</div>
	<div class="prog"></div>
</div>`,
		),
	},
];

const shots = [];
FAVICONS.forEach((f, i) => {
	for (const size of [512, 32]) {
		shots.push({
			html: f.html,
			w: size,
			h: size,
			out: `${OUT}/favicon-${i + 1}-${f.slug}-${size}.png`,
		});
	}
});
OGS.forEach((o, i) => {
	shots.push({
		html: o.html,
		w: 1200,
		h: 630,
		out: `${OUT}/og-${i + 1}-${o.slug}.png`,
	});
});

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
for (const shot of shots) {
	const p = await browser.newPage({
		viewport: { width: shot.w, height: shot.h },
		deviceScaleFactor: 1,
	});
	await p.setContent(shot.html, { waitUntil: "load" });
	await p.evaluate(() => document.fonts.ready);
	await p.screenshot({ path: shot.out });
	await p.close();
	console.log(`${shot.w}x${shot.h}  ${shot.out}`);
}
await browser.close();
console.log(`BRAND_OPTIONS_OK ${shots.length} files -> ${OUT}`);
