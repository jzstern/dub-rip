# Executing the SoundCloud support plan

This file holds the Workflow script that runs [the plan](./2026-09-20-soundcloud-support.md) one phase per run. It uses subagent-driven development (`superpowers:subagent-driven-development`) with the control flow written as code.

A controlling Claude Code session sets up a worktree, extracts the two blocks below, and runs the script with the Workflow tool. The controller never implements plan tasks itself. It relays questions, and it owns the steps that need a human: the rest of Tasks 7 and 20.

## Setup (the controller does this once per phase)

1. **Check that the plan is still current.**
   - Run `git -C <main checkout> fetch origin && git log --oneline d07e423..origin/main`, and `gh pr list --state open --json number,title,files`.
   - If a commit or open PR touches a file in the plan's File map, stop and ask the human.
   - PR #133 was open at handoff and changes the block Task 16 moves.
2. **Create a dedicated worktree from `origin/main`, from the main checkout's root.**
   - Use `feat/upload-title-metadata` for Phase 1 and `feat/soundcloud-support` for Phase 2.
   - Use `git worktree add`, not `EnterWorktree` with a `name`: the user's `worktree.baseRef: "head"` would branch from the wrong place.
   - If the worktree already exists (you're re-entering mid-phase), skip this step and the next.
3. **Phase 1 only: copy this doc and the plan into the new worktree.**
   - First run `mkdir -p <worktree>/docs/superpowers/plans`, because `origin/main` has no such folder yet.
   - After the install in step 4, also copy both files into `node_modules/.cache/dub-rip/pristine/`. That snapshot is the `pristineDocs` the audit compares against, so the run no longer depends on the authoring worktree.
   - Task 1 commits both files, so Phase 2's worktree already has them.
4. **Install and enter.** Run `bun install` in the new worktree, then call `EnterWorktree` with that `path`. Don't skip the install: Node would otherwise resolve modules from the main checkout's `node_modules`, which belongs to another branch.
5. **Extract both blocks, byte for byte,** into gitignored `node_modules/.cache`:

```bash
DOC=docs/superpowers/plans/2026-09-20-soundcloud-support.execution.md
mkdir -p node_modules/.cache/dub-rip &&
sed -n '/^```mjs$/,/^```$/{/^```/d;p;}' "$DOC" > node_modules/.cache/dub-rip/expect-audit.mjs &&
sed -n '/^```js$/,/^```$/{/^```/d;p;}' "$DOC" > node_modules/.cache/dub-rip/execute-soundcloud-plan.js &&
test -s node_modules/.cache/dub-rip/expect-audit.mjs && test -s node_modules/.cache/dub-rip/execute-soundcloud-plan.js
```

   Keep exactly one `js` block and one `mjs` block in this file.

6. **Run it:**

```
Workflow({ scriptPath: "<worktree>/node_modules/.cache/dub-rip/execute-soundcloud-plan.js",
           args: { repoDir: "<worktree>", phase: 1,
                   expectAudit: "<worktree>/node_modules/.cache/dub-rip/expect-audit.mjs",
                   pristineDocs: "<the folder the docs were copied from>" } })
```

   `pristineDocs` is required in Phase 1 only, and is the step-3 snapshot (`<worktree>/node_modules/.cache/dub-rip/pristine`). Phase 2 compares the docs with their merged version at the merge base.

## How it runs

**Scope**

An agent maps each task's line range in the plan and checks the branch and the working tree. The run halts in three cases:
- A range in the phase isn't contiguous with the next task's.
- The branch is `main`.
- There are uncommitted changes outside `docs/superpowers/`. The exception is a recovery run that names the task's base in `baseShas`: its uncommitted changes are that task's partial work.

**Each task, one at a time**

1. **Fixed base.** Each task's base commit is fixed in code, and every review sees the task's whole diff:
   - the previous task's reviewed HEAD,
   - or the scope HEAD for the first task,
   - or `args.baseShas[N]` when recovering.

   The prompts give the task's heading as well as its line range, so if the plan has shifted, an agent can find the task again.
2. **Implement.** An implementer (Sonnet) works test-first.
   - It ticks the plan's checkboxes; a Commit step's box is ticked before the commit, so the tick lands in it.
   - It commits only on green.
3. **Spec review (Sonnet).** It re-runs the suite, the type check, lint and the expect audit itself.
4. **Quality review (`superpowers:code-reviewer`, Opus).** It re-runs the same three commands.
   - If a quality fix landed, a spec recheck follows, so a quality fix can't depart from the plan unnoticed.
5. **Fix loops.** Issues go to a fixer and the review repeats, for up to 3 rounds per stage.
   - An issue whose only fix departs from the plan goes to the human instead of blocking.
   - An implementer that reports BLOCKED is retried once on Opus.
   - The human's answer, together with the halt's open issues, reaches every agent on that task. On the point it addresses, it outranks the plan text: reviewers don't re-raise it, and fixers may decline with "settled by human guidance".
   - The wrap-up agents see only the rulings themselves. A ruling that asks for a fix leaves the original problem a defect until the fix lands.

**Wrap-up, after the phase's last task**

This covers Steps 1–2 of Task 7 or Task 20.

1. `code-simplifier` runs first.
2. The audit then checks all of these:
   - The AST expect audit against the merge base: its exit code, plus the allowlist (Phase 1: none; Phase 2: the three D7 statements).
   - Every existing test line the phase removed or changed, from `git diff -U0`, checked against an exact allowlist.
     - Phase 1: none.
     - Phase 2: the three D7 assertions, one `vi.hoisted` destructuring line and the two `.map(classifyYtDlpError)` lines.
     - This catches `it.skip`, changed fixture inputs, and expects wrapped in conditions.
     - In Phase 2, it also checks that the D7 replacements say the new message.
   - Untouched paths: canary, canary route, health route, `yt-dlp-binary.ts`, `scripts/`.
   - The docs differ from their pristine copies only in checkbox ticks.
   - A clean tree.
   - `bun run test:coverage`, `check`, `lint` and `build`.
   - In Phase 2, `CI=1 bun run test:e2e`, after confirming nothing else holds port 5173.
3. A four-lens final review: regression ("no functionality lost"), correctness, plan fidelity, and `security-auditor`.
   - Duplicates are merged, keeping the most severe copy.
4. Three skeptics per non-minor finding:
   - Two read-only skeptics run in parallel.
   - The reproducing skeptic, which writes a per-finding throwaway test, runs one finding at a time.
   - Two of three must uphold a finding.
5. A clean-up agent removes the skeptics' files.
6. A lens, simplifier or skeptic that returned nothing halts the run as a review gap, rather than passing unreviewed.
7. Confirmed findings are fixed test-first, the fix gets its own review, and the phase is re-audited. Any failure halts.

**What stays with the controller:** the real-video and real-track checks, PRs, the PR environment, and production. These are the human-in-the-loop steps.

**Model defaults** follow `~/.claude/CLAUDE.md`: Sonnet by default, and Opus only where judgment is the point (code review, final review, verification, escalation). Override them with `args.models`: `{ implement, escalate, specReview, qualityReview, audit, review, verify }`.

## When a run halts

Every halt returns `halted: true`, plus:
- a `kind`, one of the kinds listed below
- a `reason`
- `results`, holding the finished tasks, including earlier runs' via `priorResults`
- a `next` object

Follow `next` exactly and never compose the args yourself.

**The kinds:**
- `question`: someone needs an answer.
  - `next.needsAnswer` is true.
  - `answers[N]` is pre-filled with the halt's reason, its open issues and its questions, after any earlier answer for that task.
  - Replace only the `<replace this placeholder …>` text with the human's answer.
- `stalled`: a review didn't converge.
  - `next.resume` raises `maxReviewRounds`.
  - If the stall was the spec recheck after a quality fix, `next.resume` is null, because more rounds would replay it.
  - `alternatives.withGuidance` carries the human's guidance to the task's agents.
- `no-result`: an agent died. `next.resume` is null, because a resume would replay the cached empty result.
- `scope`, `audit`, `simplifier`, `review-gap`, `fix-phase`: use `next.fresh` only.
  - For the four wrap-up kinds, `next.fresh` is a wrap-up-only run (`fromTask` 7 or 20) that carries the earlier results forward.
  - A `scope` halt's `next.fresh` just repeats the run once the problem is fixed.

**`next.resume`:** use it only with the run ID of the Workflow call that returned this result, never an earlier one. Use it only in the same session, and only if no lines were added to or removed from the plan since that run began; checkbox ticks don't count. Resuming with unchanged args replays the whole run from cache, halt included.

**`next.fresh`:** use it in a new session, after a plan edit, or when `next.resume` is null. It sets `fromTask`, `baseShas` (so the reviews still see the task's whole diff) and `priorResults` (so the final report stays complete).

**`next.alternatives.finishedByHand`:** use it when the human finished the task themselves; the run starts at the next task.

**Other args:**
- `fromTask` and `toTask` must stay inside the phase; `fromTask` 7 or 20 means wrap-up only.
- `toTask`: a value before the phase's last task skips the wrap-up.
- `baselineTests` carries Task 1's (or Task 8's) first test count through a halt on that task, so the PR's regression floor stays right.
- The script refuses to start while any `answers` entry still contains the placeholder.
- `acceptDocsDrift: true`: pass it only when the human edited the plan on purpose.
- `skipWrapUp`.

Before handoff:
- A mock harness exercised 28 scenario groups: every halt kind, recovery args, base chaining, answer accumulation and precedence, the gates, deduplication, serialised skeptics and argument validation.
- The rebased plan was applied onto `d07e423` in a scratch clone and ran green: 637 tests became 734 after Phase 1 and 813 after Phase 2, with `check` and `lint` clean.

## Expect audit

This prints every existing `expect(...)` statement under `tests/` that is gone or changed at HEAD compared with a base commit.
- **How it compares:** it parses each file with the repo's TypeScript and keys every statement by its enclosing `describe`/`it` titles. That way an edit anywhere in a multi-line expect counts, and an identical statement added elsewhere can't mask one.
- **Renames:** a renamed test file counts as deleted, so all of its expects are reported.
- **Errors:** it prints `AUDIT-ERROR …` and exits 1 when it can't read something.
- **Limitation:** it doesn't see changes to `it.each` table rows.

Usage: `node expect-audit.mjs <repoDir> <baseSha>`

```mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const [repo, base] = process.argv.slice(2);
if (!repo || !base) {
	console.error("usage: node expect-audit.mjs <repoDir> <baseSha>");
	process.exit(2);
}

function fail(message) {
	console.log(`AUDIT-ERROR ${message}`);
	process.exit(1);
}

let ts;
try {
	ts = createRequire(`${repo}/package.json`)("typescript");
} catch {
	fail(`cannot load typescript from ${repo}; run bun install first`);
}

const git = (...gitArgs) =>
	execFileSync("git", ["-C", repo, ...gitArgs], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});

const TEST_BLOCKS = new Set(["describe", "it", "test"]);

function rootName(node) {
	let current = node;
	while (
		ts.isCallExpression(current) ||
		ts.isPropertyAccessExpression(current) ||
		ts.isElementAccessExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return ts.isIdentifier(current) ? current.text : null;
}

function isInnerLink(node) {
	const parent = node.parent;
	if (!parent) return false;
	if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
		return parent.expression === node;
	}
	if (ts.isCallExpression(parent)) return parent.expression === node;
	return false;
}

function blockTitle(call, sourceFile) {
	const first = call.arguments[0];
	if (!first) return "?";
	if (ts.isStringLiteralLike(first)) return first.text;
	return first.getText(sourceFile);
}

function testPath(node, sourceFile) {
	const titles = [];
	for (let current = node.parent; current; current = current.parent) {
		if (ts.isCallExpression(current) && TEST_BLOCKS.has(rootName(current.expression) ?? "")) {
			titles.unshift(blockTitle(current, sourceFile));
		}
	}
	return titles.join(" › ");
}

function expectations(file, source) {
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const found = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) && rootName(node) === "expect" && !isInnerLink(node)) {
			const text = node.getText(sourceFile).replace(/\s+/g, " ");
			found.push({ key: `${testPath(node, sourceFile)} :: ${text}`, text });
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

let diffOutput;
try {
	diffOutput = git("diff", "--name-status", "--no-renames", "--diff-filter=MD", base, "HEAD", "--", "tests/");
} catch {
	fail(`git diff ${base} HEAD failed; is ${base} a commit in ${repo}?`);
}
const entries = diffOutput
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [status, file] = line.split("\t");
		return { status, file };
	})
	.filter(({ file }) => /\.(?:ts|js|mjs)$/.test(file));

const removed = [];
for (const { status, file } of entries) {
	let before;
	try {
		before = git("show", `${base}:${file}`);
	} catch {
		fail(`cannot read ${base}:${file}`);
	}
	let after = "";
	if (status !== "D") {
		try {
			after = git("show", `HEAD:${file}`);
		} catch {
			fail(`cannot read HEAD:${file}`);
		}
	}
	const remaining = new Map();
	for (const { key } of expectations(file, after)) remaining.set(key, (remaining.get(key) ?? 0) + 1);
	for (const { key, text } of expectations(file, before)) {
		const count = remaining.get(key) ?? 0;
		if (count > 0) remaining.set(key, count - 1);
		else removed.push(`${file}${status === "D" ? " (deleted or renamed)" : ""}: ${text}`);
	}
}
for (const line of removed) console.log(line);
```

## Workflow script

```js
export const meta = {
	name: "execute-soundcloud-plan",
	description:
		"Subagent-driven execution of one phase of the SoundCloud support plan: implement, spec-review and quality-review each task, then simplify, audit, and a verified final review",
	whenToUse:
		"Executing docs/superpowers/plans/2026-09-20-soundcloud-support.md, one phase per run",
	phases: [
		{ title: "Scope", detail: "Map task line ranges; check branch and working tree" },
		{
			title: "Implement",
			detail: "One task at a time: implement, spec review, quality review, fix loops",
		},
		{ title: "Audit", detail: "code-simplifier, then assertion audit and full verification" },
		{
			title: "Final review",
			detail: "Four lenses over the whole phase; three skeptics per finding",
		},
		{ title: "Fix", detail: "Fix confirmed findings, review the fix, re-audit" },
	],
};

const input = args ?? {};
const REPO = input.repoDir;
const PHASE = input.phase;
const EXPECT_AUDIT = input.expectAudit;
const PRISTINE_DOCS = input.pristineDocs;
const isAbsolute = (value) => typeof value === "string" && value.startsWith("/");
if (!isAbsolute(REPO) || (PHASE !== 1 && PHASE !== 2)) {
	throw new Error("args needs repoDir (an absolute path) and phase (1 or 2)");
}
if (!isAbsolute(EXPECT_AUDIT)) {
	throw new Error("args needs expectAudit: the absolute path of the extracted expect-audit.mjs");
}
if (PHASE === 1 && !isAbsolute(PRISTINE_DOCS)) {
	throw new Error(
		"Phase 1 needs pristineDocs: the absolute path of the directory the plan docs were copied from",
	);
}
const PLAN =
	input.planPath ?? `${REPO}/docs/superpowers/plans/2026-09-20-soundcloud-support.md`;
const DOC_FILES = [
	"2026-09-20-soundcloud-support.md",
	"2026-09-20-soundcloud-support.execution.md",
];
const PHASE_RANGE = PHASE === 1 ? [1, 6] : [8, 19];
const LAST_TASK = PHASE_RANGE[1];
const FROM = input.fromTask ?? PHASE_RANGE[0];
const TO = input.toTask ?? LAST_TASK;
const ANSWERS = input.answers ?? {};
if (FROM < PHASE_RANGE[0] || FROM > LAST_TASK + 1 || TO < FROM - 1 || TO > LAST_TASK) {
	throw new Error(
		`fromTask/toTask must stay within Phase ${PHASE}'s Tasks ${PHASE_RANGE[0]}–${LAST_TASK} (fromTask ${LAST_TASK + 1} means wrap-up only)`,
	);
}
const BASE_SHAS = input.baseShas ?? {};
const PRIOR_RESULTS = input.priorResults ?? [];
const MAX_ROUNDS = input.maxReviewRounds ?? 3;
const MODELS = {
	implement: "sonnet",
	escalate: "opus",
	specReview: "sonnet",
	qualityReview: "opus",
	audit: "sonnet",
	review: "opus",
	verify: "opus",
	...(input.models ?? {}),
};
const ALLOWED_REMOVED_EXPECTS = PHASE === 1 ? [] : ["Invalid YouTube URL"];
const MAX_ALLOWED_REMOVALS = PHASE === 1 ? 0 : 3;
const UNTOUCHED_PATHS = [
	"src/lib/canary",
	"src/routes/api/canary",
	"src/routes/api/health",
	"src/lib/yt-dlp-binary.ts",
	"scripts",
];
const RUN_WRAP_UP = TO === LAST_TASK && input.skipWrapUp !== true;
const STAGE_NAME = { spec: "spec compliance", quality: "code quality" };
const ANSWER_SLOT = "<replace this placeholder with the human's answer>";
const CODE_DIFF_FILTER = "-- . ':(exclude)docs/superpowers'";
const SEVERITY_RANK = { critical: 0, important: 1, minor: 2 };
for (const [n, text] of Object.entries(ANSWERS)) {
	if (typeof text !== "string" || text.includes(ANSWER_SLOT)) {
		throw new Error(`answers["${n}"] still contains the placeholder; put the human's answer in it first`);
	}
}
const ALLOWED_REMOVED_TEST_LINES =
	PHASE === 1
		? []
		: [
				'expect(text).toBe("Invalid YouTube URL");',
				'expect(text).toBe("Invalid YouTube URL");',
				'expect(data.error).toBe("Invalid YouTube URL");',
				"const { resolveAlbumArtImageMock, registerDownloadMock } = vi.hoisted(() => ({",
				"const results = userFailures.map(classifyYtDlpError);",
				"const results = transientFailures.map(classifyYtDlpError);",
			];
const D7_REPLACEMENT = "Paste a YouTube video or SoundCloud track link";

const RANGE = {
	type: "object",
	properties: { startLine: { type: "integer" }, endLine: { type: "integer" } },
	required: ["startLine", "endLine"],
};

const SCOPE_SCHEMA = {
	type: "object",
	properties: {
		branch: { type: "string" },
		headSha: { type: "string" },
		statusLines: {
			type: "array",
			items: { type: "string" },
			description: "every line of `git status --porcelain`, verbatim",
		},
		tasks: {
			type: "array",
			items: {
				type: "object",
				properties: {
					number: { type: "integer" },
					title: { type: "string" },
					startLine: { type: "integer" },
					endLine: { type: "integer" },
				},
				required: ["number", "title", "startLine", "endLine"],
			},
		},
		sections: {
			type: "object",
			properties: { research: RANGE, guardrail: RANGE, deliberate: RANGE, fileMap: RANGE },
			required: ["research", "guardrail", "deliberate", "fileMap"],
		},
	},
	required: ["branch", "headSha", "statusLines", "tasks", "sections"],
};

const WORK_SCHEMA = {
	type: "object",
	properties: {
		status: {
			type: "string",
			enum: ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"],
		},
		headSha: { type: "string", description: "`git rev-parse HEAD` when you finished" },
		summary: { type: "string" },
		filesChanged: { type: "array", items: { type: "string" } },
		testResults: {
			type: "string",
			description: "each command you ran and its real pass/fail counts",
		},
		concerns: { type: "array", items: { type: "string" } },
		questions: {
			type: "array",
			items: { type: "string" },
			description: "for NEEDS_CONTEXT or BLOCKED: exactly what you need",
		},
	},
	required: ["status", "headSha", "summary", "filesChanged", "testResults", "concerns", "questions"],
};

const ISSUE = {
	type: "object",
	properties: {
		severity: { type: "string", enum: ["critical", "important", "minor"] },
		file: { type: "string" },
		line: { type: "integer" },
		description: { type: "string" },
		conflictsWithPlan: {
			type: "boolean",
			description: "true if fixing it would mean departing from the plan's code or decisions",
		},
	},
	required: ["severity", "file", "description", "conflictsWithPlan"],
};

const CHECKS = {
	suiteGreen: { type: "boolean", description: "`bun run test:run` passed" },
	checkGreen: { type: "boolean", description: "`bun run check` passed" },
	lintGreen: { type: "boolean", description: "`bun run lint` passed" },
	headSha: { type: "string", description: "`git rev-parse HEAD` as you reviewed" },
};

const SPEC_SCHEMA = {
	type: "object",
	properties: {
		compliant: { type: "boolean" },
		...CHECKS,
		issues: { type: "array", items: ISSUE },
		notes: { type: "string" },
	},
	required: ["compliant", "suiteGreen", "checkGreen", "lintGreen", "headSha", "issues", "notes"],
};

const QUALITY_SCHEMA = {
	type: "object",
	properties: {
		approved: { type: "boolean" },
		...CHECKS,
		strengths: { type: "array", items: { type: "string" } },
		issues: { type: "array", items: ISSUE },
		assessment: { type: "string" },
	},
	required: [
		"approved",
		"suiteGreen",
		"checkGreen",
		"lintGreen",
		"headSha",
		"strengths",
		"issues",
		"assessment",
	],
};

const AUDIT_SCHEMA = {
	type: "object",
	properties: {
		mergeBase: { type: "string" },
		headSha: { type: "string" },
		expectAuditExitCode: { type: "integer" },
		removedExpectLines: { type: "array", items: { type: "string" } },
		removedTestLines: { type: "array", items: { type: "string" } },
		d7ReplacementCount: { type: "integer" },
		untouchedChanged: { type: "array", items: { type: "string" } },
		docsDrift: { type: "array", items: { type: "string" } },
		dirtyLines: { type: "array", items: { type: "string" } },
		coverageGreen: {
			type: "boolean",
			description: "`bun run test:coverage` passed, thresholds included",
		},
		checkGreen: { type: "boolean" },
		lintGreen: { type: "boolean" },
		buildGreen: { type: "boolean" },
		e2eGreen: {
			type: "boolean",
			description: "true if e2e passed, or if e2e is not required in this phase",
		},
		details: { type: "string", description: "failing test names and error output, if any" },
	},
	required: [
		"mergeBase",
		"headSha",
		"expectAuditExitCode",
		"removedExpectLines",
		"removedTestLines",
		"d7ReplacementCount",
		"untouchedChanged",
		"docsDrift",
		"dirtyLines",
		"coverageGreen",
		"checkGreen",
		"lintGreen",
		"buildGreen",
		"e2eGreen",
		"details",
	],
};

const SIMPLIFY_SCHEMA = {
	type: "object",
	properties: {
		changed: { type: "boolean" },
		summary: { type: "string" },
		suiteGreen: { type: "boolean" },
		checkGreen: { type: "boolean" },
		lintGreen: { type: "boolean" },
	},
	required: ["changed", "summary", "suiteGreen", "checkGreen", "lintGreen"],
};

const STATUS_SCHEMA = {
	type: "object",
	properties: { statusLines: { type: "array", items: { type: "string" } } },
	required: ["statusLines"],
};

const FINDINGS_SCHEMA = {
	type: "object",
	properties: {
		findings: {
			type: "array",
			items: {
				type: "object",
				properties: {
					severity: { type: "string", enum: ["critical", "important", "minor"] },
					title: { type: "string" },
					file: { type: "string" },
					line: { type: "integer" },
					description: { type: "string" },
					evidence: { type: "string" },
				},
				required: ["severity", "title", "file", "description", "evidence"],
			},
		},
	},
	required: ["findings"],
};

const VERDICT_SCHEMA = {
	type: "object",
	properties: { refuted: { type: "boolean" }, reasoning: { type: "string" } },
	required: ["refuted", "reasoning"],
};

function lines(range) {
	return `lines ${range.startLine}–${range.endLine}`;
}

function argsWith(patch) {
	return { ...input, ...patch };
}

function isDocsLine(line) {
	return line.includes("docs/superpowers/");
}

const RESUME_RULES = `Resume only with the run ID of the Workflow call that returned THIS result, never an earlier run's ID. Resume only in the same session, and only if no lines were added to or removed from the plan since this run began; checkbox ticks don't count. Otherwise use next.fresh.`;

function scopeHalt(reason, details) {
	return {
		halted: true,
		kind: "scope",
		reason,
		...details,
		next: {
			needsAnswer: false,
			resume: null,
			fresh: argsWith({}),
			instructions:
				"Fix the problem, then start a FRESH run with next.fresh as args and no resumeFromRunId. A resume would replay this cached halt.",
		},
	};
}

function scopePrompt() {
	return `Map an implementation plan so other agents can read exact slices of it. Do not modify anything.

Repository: ${REPO}. Plan: ${PLAN}.

1. Run \`cd ${REPO} && git branch --show-current && git rev-parse HEAD && git status --porcelain\`.
2. Run \`grep -n '^### Task \\|^## ' ${PLAN}\`.
3. Report every "### Task N: <title>" heading.
   - startLine is the heading's line.
   - endLine is the line before the next "### Task" heading. For the plan's last task, it is the line before the next top-level "## " heading after it.
   - Ignore any "## " line that sits inside a fenced code block. Task 19 contains one.
4. Report the line ranges of four sections. Each runs from its heading to the line before the next top-level "## " heading:
   - "## Research behind this plan"
   - "## Guardrail: no functionality lost"
   - "## Deliberate behavior changes"
   - "## File map"
5. Return the git facts verbatim.`;
}

phase("Scope");
const scope = await agent(scopePrompt(), {
	label: "Scope: map plan and branch",
	phase: "Scope",
	schema: SCOPE_SCHEMA,
	model: MODELS.audit,
	effort: "low",
});
if (!scope) return scopeHalt("The scope agent returned nothing");
if (scope.branch === "main" || scope.branch === "master") {
	return scopeHalt(`On ${scope.branch}. The plan must never run on the default branch.`);
}
const mapped = [...scope.tasks].sort((a, b) => a.number - b.number);
for (let n = PHASE_RANGE[0]; n <= LAST_TASK; n++) {
	const task = mapped.find((t) => t.number === n);
	const following = mapped.find((t) => t.number === n + 1);
	if (!task) return scopeHalt(`Task ${n} is missing from the plan map`, { tasks: mapped });
	if (task.endLine <= task.startLine || (following && task.endLine !== following.startLine - 1)) {
		return scopeHalt(`The plan map is malformed around Task ${n}`, { tasks: mapped });
	}
}
const tasks = [];
for (let n = FROM; n <= TO; n++) tasks.push(mapped.find((t) => t.number === n));
const recoveringTask = tasks.length > 0 && BASE_SHAS[String(FROM)] !== undefined;
const strayChanges = scope.statusLines.filter((line) => !isDocsLine(line));
if (strayChanges.length > 0 && !recoveringTask) {
	return scopeHalt(
		"Uncommitted changes outside docs/superpowers/. Commit or discard them, then start fresh.",
		{ strayChanges },
	);
}
if (strayChanges.length > 0) {
	log(`Keeping uncommitted changes as Task ${FROM}'s partial work: ${strayChanges.join(" | ")}`);
}
log(
	tasks.length
		? `Branch ${scope.branch} at ${scope.headSha.slice(0, 7)}; running Tasks ${FROM}–${TO}`
		: `Branch ${scope.branch} at ${scope.headSha.slice(0, 7)}; wrap-up only`,
);

const sec = scope.sections;
function sectionPointer(heading, range) {
	return `"${heading}" (${lines(range)} when this run started; if line ${range.startLine} isn't that heading or line ${range.endLine + 1} doesn't start the next "## " heading, grep for it)`;
}
const e2eRule =
	PHASE === 2
		? `
6. Before any \`bun run test:e2e\`, including the ones a plan step names:
   - Run \`lsof -nP -iTCP:5173 -sTCP:LISTEN\`. If anything is listening, don't run e2e, and never kill that process. Report BLOCKED with its PID and working directory (\`lsof -a -p <pid> -d cwd\`).
   - Otherwise run \`CI=1 bun run test:e2e\`, so Playwright never reuses a server from another checkout.`
		: "";
const CONTEXT = `You are one subagent in a subagent-driven execution of an implementation plan for dub-rip, a SvelteKit 5 + Bun app that downloads YouTube (and, once this plan lands, SoundCloud) audio with rich ID3 tags.

- Repository: ${REPO}. Run every command there, with \`cd ${REPO} && …\` in the same shell call.
- Plan: ${PLAN}. Before anything else, read these shared sections with the Read tool (offset/limit):
  - ${sectionPointer("## Guardrail: no functionality lost", sec.guardrail)}
  - ${sectionPointer("## Deliberate behavior changes", sec.deliberate)}
  - ${sectionPointer("## File map", sec.fileMap)}
  Read ${sectionPointer("## Research behind this plan", sec.research)} only if you need the evidence behind a decision.
- This is Phase ${PHASE} of 2. ${
	PHASE === 1
		? "Phase 1 is the metadata groundwork. It may change YouTube output only in the ways D1–D6 describe."
		: "Phase 2 adds SoundCloud. YouTube behavior must stay exactly as Phase 1 left it."
}
- Code diffs below use \`${CODE_DIFF_FILTER}\` to leave out docs/superpowers/. That folder holds the plan itself: implementers tick its checkboxes, and Task 1 commits the plan and its execution doc.

Hard rules. The plan's Guardrail section explains why.
1. Never change an existing \`expect(...)\` statement under tests/ unless the Deliberate behavior changes table lists it. That covers every line of a multi-line expect. Edit mock factories or fixtures only where a task says to.
2. The plan's code blocks are authoritative. They were checked against this repo and an independent reviewer ran them against their own fixtures. Copy them exactly, regexes especially, and don't "improve" them.
3. Line numbers in the plan are locators, not guarantees; find code by its content. If the code a step describes isn't there, or differs in substance rather than just position (for example, a PR merged since the plan was written changed it), stop and report NEEDS_CONTEXT. Don't improvise.
4. Stay local. Never push, open or merge PRs, or change remote, Railway or Sentry state. Never commit to main. Never start a dev server yourself; the one Playwright's webServer starts during \`bun run test:e2e\` is the only exception.
5. Use Bun (\`bun run …\`, \`bunx …\`). Format code you paste with \`bunx biome check --write <files>\`, never with \`--unsafe\`. Stage files by explicit path; never \`git add -A\` or \`git add .\`. Git tracks the project instructions as \`.claude/claude.md\` (lowercase), so stage that exact path.${e2eRule}
${PHASE === 2 ? "7" : "6"}. Never edit anything under docs/superpowers/ except ticking a checkbox (\`- [ ]\` → \`- [x]\`), and never raise findings about those files.`;

function taskLocator(task) {
	return `the full text of Task ${task.number} in the plan: from the line "### Task ${task.number}: ${task.title}" to the line before the next "### Task" heading. When this run started, that was ${lines(task)}. Read that range with the Read tool, and check two things: its first line is that heading, and line ${task.endLine + 1} is the heading "### Task ${task.number + 1}: …". If either isn't so, the plan has shifted: find the heading with \`grep -n '^### Task ' ${PLAN}\`, use the current range, and mention the shift in your concerns`;
}

function guidanceBlock(task) {
	const guidance = ANSWERS[String(task.number)];
	if (!guidance) return "";
	return `
An earlier attempt at this task halted, and the human ruled on it. Each "Human's answer:" below is the human's ruling. On the point it addresses, it outranks the plan text and hard rule 2:
- a spec reviewer must not list an issue a ruling settles
- a quality reviewer sets conflictsWithPlan: true on one
- a fixer may decline one with "<finding>: settled by human guidance"
${guidance}
`;
}

function rulingsOf(text) {
	const rulings = [...text.matchAll(/Human's answer: ([\s\S]*?)(?=\n\nHalt on Task |$)/g)].map((m) =>
		m[1].trim(),
	);
	return rulings.length ? rulings : [text.trim()];
}

function decisionsBlock() {
	const entries = Object.entries(ANSWERS);
	if (entries.length === 0) return "";
	return `
The human made these rulings during this phase. A ruling that accepts a deviation from the plan makes that deviation intended, like the Deliberate behavior changes table. A ruling that asks for a fix means the fix is expected, and the original problem is still a defect if it remains.
${entries.map(([n, text]) => `- Task ${n}: ${rulingsOf(text).join(" / ")}`).join("\n")}
`;
}

function implementPrompt(task, taskBase, previous) {
	const previousBlock = previous
		? `
The previous attempt in this run reported ${previous.status}: ${previous.summary}
Its blockers: ${previous.questions.join("; ") || "none given"}
`
		: "";
	return `${CONTEXT}

## Your task: Task ${task.number}, ${task.title}

Your specification is ${taskLocator(task)}. Every earlier task is already done and committed.
This task's work starts at commit ${taskBase}. Commits after it, and any uncommitted changes, are partial work on this same task from an earlier attempt. Check \`git log --oneline ${taskBase}..HEAD\` and \`git status\` first, keep whatever matches the plan, and continue from there. Never redo a commit that already exists.
${guidanceBlock(task)}${previousBlock}
## Your job
1. Follow the task's steps in order:
   - Work test-first, as the steps say. Watch each new test fail for the reason the step predicts before you implement. If it fails for a different reason, stop and report.
   - Run every command a step names, and compare its output with the step's "Expected".
   - As you finish each step, tick its checkbox in the plan file (\`- [ ]\` → \`- [x]\`). Tick a Commit step's box before you run that \`git commit\`, and stage the plan file with it, so every tick is committed.
   - Commit exactly as the steps say, and only when \`bun run test:run\`, \`bun run check\` and \`bun run lint\` pass.
   - If a step tells you to stop and ask, or its expectation doesn't hold, report NEEDS_CONTEXT with the exact question. Don't guess.
2. Self-review before you report:
   - Is every step done?
   - Did you add nothing the task didn't ask for?
   - Comments: none that restate what the code does (.claude/rules/comments.md).
   - Tabs, and explicit return types on exported functions.
   - New tests have BDD \`#given/#when/#then\` comments.
3. Run \`bun run test:run\`, \`bun run check\` and \`bun run lint\`, and report their real results, including the total count of passing tests.

## Status
Report the status honestly:
- DONE: every step is complete and all three commands pass.
- DONE_WITH_CONCERNS: the work is complete but you have doubts. List them.
- NEEDS_CONTEXT: you need an answer that neither the repo nor the plan gives you.
- BLOCKED: you cannot complete the task.`;
}

function declinedBlock(declined) {
	if (declined.length === 0) return "";
	return `
After the previous review round, the implementer declined to change the following. They say each item either already matches the plan text exactly or is settled by the human's guidance, so changing it would depart from the plan or the ruling:
${declined.map((d) => `- ${d}`).join("\n")}
Check each against the plan and the guidance. If the claim holds, the item is compliant; for code quality, set conflictsWithPlan: true.
`;
}

const VERIFY_STEPS =
	"Run `bun run test:run`, `bun run check` and `bun run lint` yourself, and report their real outcomes.";

function specPrompt(task, impl, taskBase, declined) {
	return `${CONTEXT}

## Spec compliance review: Task ${task.number}, ${task.title}

What was requested: ${taskLocator(task)}. Read all of it.
The task's whole diff is ${taskBase}..HEAD. That may include an earlier attempt's commits; review them all.
${guidanceBlock(task)}
What the implementer says they built:
${impl.summary}
Files: ${impl.filesChanged.join(", ") || "none listed"}.
Tests: ${impl.testResults}.
Concerns: ${impl.concerns.join("; ") || "none"}.
${declinedBlock(declined)}
Don't trust that report; implementers are often optimistic. Verify it yourself:
1. Read \`git diff ${taskBase}..HEAD ${CODE_DIFF_FILTER}\` and compare it with the task text, step by step. Look for:
   - missing pieces
   - extra work nobody asked for
   - misreadings
   - code that differs from the plan's code blocks (compare regexes and argv arrays character by character)
   Also check \`git show --stat ${taskBase}..HEAD\`: the files the task says to commit must actually be committed.
2. Guardrail rule 1: \`node ${EXPECT_AUDIT} ${REPO} ${taskBase}\` prints every existing expect statement that was changed or removed. It must exit 0 and print nothing, except statements the Deliberate behavior changes table lists. A non-zero exit or an AUDIT-ERROR line is itself an issue.
   Also run \`git diff --no-renames -U0 ${taskBase}..HEAD -- tests/ | grep '^-' | grep -v '^---'\`. Every existing test line removed or changed must be one this task explicitly says to change. Disabling a test (\`it.skip\`), changing a fixture's input, or wrapping an expect in a condition is an issue.
3. ${VERIFY_STEPS}

Set compliant to true only if nothing is missing, extra or misread. Give every issue a file and line, and set conflictsWithPlan to false.`;
}

function qualityPrompt(task, impl, taskBase, declined) {
	return `${CONTEXT}

## Code quality review: Task ${task.number}, ${task.title}

Review \`git diff ${taskBase}..HEAD ${CODE_DIFF_FILTER}\`. The requirements are ${taskLocator(task)}. Spec compliance was verified before this review; if a quality fix lands, a spec recheck runs afterwards.
What was implemented: ${impl.summary}
${guidanceBlock(task)}${declinedBlock(declined)}
Check for:
- correctness and edge cases
- error handling that follows .claude/CLAUDE.md "Error Reporting": a caught error must be captured, an incident is reported once, and expected failures never become events
- type safety, and explicit return types on exports
- tests that assert behavior rather than mocks, in BDD form
- the comment policy in .claude/rules/comments.md
- clear naming, and one responsibility per file
- nothing large added to a file that is already large

Only flag code in this task's diff. ${VERIFY_STEPS}

The plan has the final say on design: its regexes, precedence orders, argv, file layout and deferred items are decided. If fixing an issue would mean departing from the plan, set conflictsWithPlan: true. The human reviews those, and they don't block the task.
Set approved to true when no critical or important issue remains that doesn't conflict with the plan. If you set it to false, list the blocking issue.`;
}

function formatIssue(issue, i) {
	return `${i + 1}. [${issue.severity}] ${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.description}`;
}

function fixPrompt(task, stage, open, taskBase) {
	return `${CONTEXT}

## Fix ${STAGE_NAME[stage]} findings for Task ${task.number}, ${task.title}

The task's text is ${taskLocator(task)}. Its work so far is ${taskBase}..HEAD.
${guidanceBlock(task)}
A ${STAGE_NAME[stage]} reviewer found:
${open.map(formatIssue).join("\n")}

Fix each finding, with two exceptions:
- If the code already matches the plan's text exactly and the fix would depart from the plan, leave it, and add "<finding>: matches the plan because …" to your concerns.
- If the human's guidance above settles it, leave it, and add "<finding>: settled by human guidance" to your concerns.
The hard rules still apply: existing expect statements stay untouched, and the plan's code blocks are authoritative.

Then:
1. Re-run the task's own tests, then \`bun run test:run\`, \`bun run check\` and \`bun run lint\`.
2. Commit only if all three pass, staging files by explicit path, as \`fix: address ${STAGE_NAME[stage]} review for Task ${task.number}\`. If they don't pass and you can't make them pass, don't commit; report BLOCKED with the failing test names.
3. Report.`;
}

function redChecks(review) {
	const checks = [
		["suiteGreen", "bun run test:run"],
		["checkGreen", "bun run check"],
		["lintGreen", "bun run lint"],
	];
	return checks
		.filter(([key]) => !review[key])
		.map(([, command]) => ({
			severity: "important",
			file: "-",
			description: `\`${command}\` fails`,
			conflictsWithPlan: false,
		}));
}

function blockingIssues(stage, review) {
	if (!review) {
		return [
			{
				severity: "important",
				file: "-",
				description: "the reviewer returned no result",
				conflictsWithPlan: false,
			},
		];
	}
	const listed =
		stage === "quality"
			? review.issues.filter((i) => i.severity !== "minor" && !i.conflictsWithPlan)
			: [...review.issues];
	const open = [...listed, ...redChecks(review)];
	const verdictOk = stage === "quality" ? review.approved : review.compliant;
	const onlyPlanConflicts =
		stage === "quality" && review.issues.length > 0 && review.issues.every((i) => i.conflictsWithPlan);
	if (!verdictOk && open.length === 0 && !onlyPlanConflicts) {
		open.push({
			severity: "important",
			file: "-",
			description: `the reviewer did not pass the task: ${stage === "quality" ? review.assessment : review.notes}`,
			conflictsWithPlan: false,
		});
	}
	return open;
}

async function reviewUntilClean(task, stage, taskBase, startImpl, concerns) {
	let impl = startImpl;
	let declined = [];
	const noted = [];
	for (let round = 1; round <= MAX_ROUNDS; round++) {
		const review =
			stage === "spec"
				? await agent(specPrompt(task, impl, taskBase, declined), {
						label: `Task ${task.number}: spec review ${round}`,
						phase: "Implement",
						schema: SPEC_SCHEMA,
						model: MODELS.specReview,
					})
				: await agent(qualityPrompt(task, impl, taskBase, declined), {
						label: `Task ${task.number}: quality review ${round}`,
						phase: "Implement",
						schema: QUALITY_SCHEMA,
						model: MODELS.qualityReview,
						agentType: "superpowers:code-reviewer",
					});
		if (review && stage === "quality") {
			noted.push(...review.issues.filter((i) => i.conflictsWithPlan || i.severity === "minor"));
		}
		const open = blockingIssues(stage, review);
		if (open.length === 0) return { ok: true, impl, review, noted };
		if (round === MAX_ROUNDS) {
			return review
				? { ok: false, stall: "rounds", open, noted }
				: {
						ok: false,
						stall: "no-result",
						reason: `the ${STAGE_NAME[stage]} reviewer returned nothing in round ${round}`,
						open: [],
						noted,
					};
		}
		if (!review) continue;
		const fix = await agent(fixPrompt(task, stage, open, taskBase), {
			label: `Task ${task.number}: fix ${stage} round ${round}`,
			phase: "Implement",
			schema: WORK_SCHEMA,
			model: MODELS.implement,
		});
		if (!fix) {
			return {
				ok: false,
				stall: "no-result",
				reason: `the ${STAGE_NAME[stage]} fixer returned nothing in round ${round}`,
				open,
				noted,
			};
		}
		if (fix.status === "NEEDS_CONTEXT" || fix.status === "BLOCKED") {
			return {
				ok: false,
				stall: "question",
				reason: `a ${STAGE_NAME[stage]} fixer reported ${fix.status}`,
				questions: fix.questions,
				open,
				noted,
			};
		}
		concerns.push(...fix.concerns);
		declined = fix.concerns;
		impl = {
			...fix,
			summary: `${impl.summary}\nAfter ${STAGE_NAME[stage]} review round ${round}: ${fix.summary}`,
		};
	}
	return { ok: false, stall: "rounds", open: [], noted };
}

function uniqueIssues(issues) {
	const seen = new Set();
	return issues.filter((i) => {
		const key = `${i.file}:${i.line ?? ""}:${i.description}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function answerTemplate(task, reason, open, questions) {
	const prior = ANSWERS[String(task.number)];
	const context = [
		`Halt on Task ${task.number}: ${reason}`,
		open.length ? `Open issues:\n${open.map(formatIssue).join("\n")}` : "",
		questions.length ? `Questions:\n${questions.map((q) => `- ${q}`).join("\n")}` : "",
		`Human's answer: ${ANSWER_SLOT}`,
	]
		.filter(Boolean)
		.join("\n");
	return prior ? `${prior}\n\n${context}` : context;
}

function taskHalt(task, taskBase, kind, reason, details) {
	const n = String(task.number);
	const open = details.open ?? [];
	const questions = details.questions ?? [];
	const baseShas = { ...BASE_SHAS, [n]: taskBase };
	const priorResults = [...PRIOR_RESULTS, ...results];
	const answers = { ...ANSWERS, [n]: answerTemplate(task, reason, open, questions) };
	const baselineTests =
		input.baselineTests ??
		(task.number === PHASE_RANGE[0] && details.baselineTestResults ? details.baselineTestResults : undefined);
	const carried = baselineTests ? { baselineTests } : {};
	const finishedByHand = argsWith({ fromTask: task.number + 1, priorResults, ...carried });
	const fresh = argsWith({ fromTask: task.number, baseShas, priorResults, ...carried });
	const common = {
		halted: true,
		kind,
		haltedAt: task.number,
		taskBase,
		reason,
		...details,
		note: `Task ${n}'s checkboxes may be ticked and committed even though it didn't pass review; they aren't acceptance.`,
	};
	if (kind === "question") {
		return {
			...common,
			next: {
				needsAnswer: true,
				resume: argsWith({ answers, baseShas, ...carried }),
				fresh: argsWith({ fromTask: task.number, answers, baseShas, priorResults, ...carried }),
				alternatives: { finishedByHand },
				instructions: `Ask the human the question(s). In answers["${n}"], replace only ${JSON.stringify(ANSWER_SLOT)} with their answer, and keep everything else in that entry, including earlier answers. ${RESUME_RULES} If the human finished Task ${n} by hand, start fresh with alternatives.finishedByHand.`,
			},
		};
	}
	if (kind === "stalled") {
		const moreRounds = details.noMoreRounds !== true;
		return {
			...common,
			next: {
				needsAnswer: false,
				resume: moreRounds
					? argsWith({ maxReviewRounds: MAX_ROUNDS + 2, baseShas, ...carried })
					: null,
				fresh,
				alternatives: {
					withGuidance: argsWith({
						fromTask: task.number,
						answers,
						baseShas,
						priorResults,
						...carried,
					}),
					finishedByHand,
				},
				instructions: `Show the human the open issues and ask how to proceed. The options:
${moreRounds ? `- More review rounds: resume with next.resume. ${RESUME_RULES}\n` : ""}- Guidance for Task ${n}'s agents: in alternatives.withGuidance.answers["${n}"], replace only the placeholder with the human's words, then start fresh with it.
- The human fixed it by hand: start fresh with alternatives.finishedByHand.
Never add an answers entry the human didn't write.`,
			},
		};
	}
	return {
		...common,
		next: {
			needsAnswer: false,
			resume: null,
			fresh,
			alternatives: { finishedByHand },
			instructions: `An agent died, and a resume would replay its cached empty result. Start a FRESH run with next.fresh (no resumeFromRunId). If uncommitted partial work is present, that run keeps it as Task ${n}'s partial work. If the human finished Task ${n} by hand, use alternatives.finishedByHand.`,
		},
	};
}

async function implementTask(task, taskBase) {
	const tag = `Task ${task.number}`;
	const workOpts = (label, model) => ({ label, phase: "Implement", schema: WORK_SCHEMA, model });
	let impl = await agent(
		implementPrompt(task, taskBase),
		workOpts(`${tag}: implement`, MODELS.implement),
	);
	const baselineTestResults = impl ? impl.testResults : "";
	if (impl && impl.status === "BLOCKED") {
		log(
			`${tag} blocked on ${MODELS.implement} (${impl.questions.join("; ")}); retrying once on ${MODELS.escalate}`,
		);
		impl = await agent(
			implementPrompt(task, taskBase, impl),
			workOpts(`${tag}: implement (escalated)`, MODELS.escalate),
		);
	}
	if (!impl) {
		return taskHalt(task, taskBase, "no-result", "the implementer returned nothing", {});
	}
	if (impl.status === "NEEDS_CONTEXT" || impl.status === "BLOCKED") {
		return taskHalt(task, taskBase, "question", `the implementer reported ${impl.status}`, {
			questions: impl.questions,
			summary: impl.summary,
			baselineTestResults,
		});
	}

	const concerns = [...impl.concerns];
	const stages = {};
	let current = impl;
	for (const stage of ["spec", "quality"]) {
		const outcome = await reviewUntilClean(task, stage, taskBase, current, concerns);
		if (!outcome.ok) {
			const kind =
				outcome.stall === "question" ? "question" : outcome.stall === "no-result" ? "no-result" : "stalled";
			return taskHalt(
				task,
				taskBase,
				kind,
				outcome.reason ?? `${STAGE_NAME[stage]} review still has open issues after ${MAX_ROUNDS} rounds`,
				{ questions: outcome.questions ?? [], open: outcome.open, concerns, baselineTestResults },
			);
		}
		stages[stage] = outcome;
		current = outcome.impl;
	}

	let headSha = stages.quality.review.headSha;
	if (stages.quality.impl !== stages.spec.impl) {
		const recheck = await agent(specPrompt(task, stages.quality.impl, taskBase, []), {
			label: `${tag}: spec recheck`,
			phase: "Implement",
			schema: SPEC_SCHEMA,
			model: MODELS.specReview,
		});
		const open = blockingIssues("spec", recheck);
		if (open.length) {
			return taskHalt(
				task,
				taskBase,
				recheck ? "stalled" : "no-result",
				recheck
					? "the spec recheck after quality fixes found issues"
					: "the spec recheck reviewer returned nothing",
				{ questions: [], open: recheck ? open : [], concerns, baselineTestResults, noMoreRounds: true },
			);
		}
		headSha = recheck.headSha;
	}

	const noted = uniqueIssues(stages.quality.noted);
	return {
		task: task.number,
		title: task.title,
		halted: false,
		taskBase,
		headSha,
		baselineTestResults,
		testResults: current.testResults,
		concerns,
		planConflicts: noted.filter((i) => i.conflictsWithPlan),
		minorIssues: noted.filter((i) => !i.conflictsWithPlan),
	};
}

phase("Implement");
const results = [];
let previousHead = null;
for (const task of tasks) {
	const taskBase = BASE_SHAS[String(task.number)] ?? previousHead ?? scope.headSha;
	log(`Task ${task.number} starts at ${taskBase}`);
	const result = await implementTask(task, taskBase);
	if (result.halted) {
		log(`Stopped at Task ${task.number}: ${result.reason}`);
		return { ...result, results };
	}
	results.push(result);
	previousHead = result.headSha;
	log(
		`Task ${task.number} clean (${taskBase.slice(0, 7)}..${result.headSha.slice(0, 7)})` +
			(result.planConflicts.length
				? `; ${result.planConflicts.length} plan conflict(s) noted for the human`
				: ""),
	);
}
const allResults = [...PRIOR_RESULTS, ...results];
if (!RUN_WRAP_UP) {
	return {
		halted: false,
		results: allResults,
		wrapUp: "skipped (toTask is before the phase's last task, or skipWrapUp is set)",
	};
}

function wrapUpHalt(kind, reason, details) {
	return {
		halted: true,
		kind,
		reason,
		results: allResults,
		...details,
		next: {
			needsAnswer: false,
			resume: null,
			fresh: argsWith({ fromTask: LAST_TASK + 1, priorResults: allResults }),
			instructions:
				"Show the human the problems. Once they're fixed, start a FRESH run with next.fresh as args (wrap-up only, no resumeFromRunId); a resume would replay this cached failure. next.fresh carries the finished tasks' results forward.",
		},
	};
}

function auditPrompt() {
	const pristine = (file) =>
		PHASE === 1
			? `sed -E 's/^([[:space:]]*)- \\[x\\]/\\1- [ ]/' "${PRISTINE_DOCS}/${file}"`
			: `git show <mergeBase>:docs/superpowers/plans/${file} | sed -E 's/^([[:space:]]*)- \\[x\\]/\\1- [ ]/'`;
	const docsSteps = DOC_FILES.map(
		(file) =>
			`   \`diff <(${pristine(file)}) <(sed -E 's/^([[:space:]]*)- \\[x\\]/\\1- [ ]/' docs/superpowers/plans/${file})\``,
	).join("\n");
	const e2e =
		PHASE === 2
			? `
7. e2e: run \`lsof -nP -iTCP:5173 -sTCP:LISTEN\` first.
   - If anything is listening, don't run e2e and never kill it. Set e2eGreen to false, and put the process and its working directory (\`lsof -a -p <pid> -d cwd\`) in details.
   - Otherwise run \`CI=1 bun run test:e2e\`.
   - If Playwright's browser is missing, run \`bunx playwright install chromium\` first.
   - If the dev server returns 403 for client files in this worktree, set \`server.fs.strict: false\` in vite.config.ts, re-run, and revert that edit afterwards.`
			: `
7. e2e isn't required in Phase 1, which has no UI changes. Set e2eGreen to true.`;
	return `${CONTEXT}

## Phase ${PHASE} audit
Change nothing, except the temporary vite edit described below, which you must revert.
1. \`cd ${REPO} && git fetch origin && git merge-base HEAD origin/main && git rev-parse HEAD\`. These give mergeBase and headSha.
2. \`node ${EXPECT_AUDIT} ${REPO} <mergeBase>; echo "exit=$?"\`. Return the exit code in expectAuditExitCode, and every other output line verbatim in removedExpectLines.
2b. \`git diff --no-renames -U0 <mergeBase>..HEAD -- tests/ | grep '^-' | grep -v '^---'\`. These are the existing test lines this phase removed or changed. Return every line verbatim in removedTestLines.
2c. ${PHASE === 2 ? `\`git grep -c "${D7_REPLACEMENT}" HEAD -- tests/unit/api/preview.test.ts tests/unit/api/download-stream.test.ts\`. Return the total count in d7ReplacementCount.` : "Set d7ReplacementCount to 0; D7 is a Phase 2 change."}
3. \`git diff --name-only <mergeBase>..HEAD -- ${UNTOUCHED_PATHS.join(" ")}\`. These paths must not change in this plan. Return every line in untouchedChanged.
4. The docs must differ from their pristine copies only in checkbox ticks. Run each of these, and return every output line in docsDrift:
${docsSteps}
5. \`git status --porcelain\`. Return every line in dirtyLines.
6. Run \`bun run test:coverage\` (the suite plus CI's coverage thresholds), \`bun run check\`, \`bun run lint\` and \`bun run build\`.${e2e}
Report the real outcomes. Put failing test names and error output in details.`;
}

function auditFailures(audit) {
	if (!audit) return ["the audit agent returned nothing"];
	const problems = [];
	if (audit.expectAuditExitCode !== 0) {
		problems.push(`the expect audit exited ${audit.expectAuditExitCode}`);
	}
	const auditErrors = audit.removedExpectLines.filter((line) => line.startsWith("AUDIT-ERROR"));
	const statements = audit.removedExpectLines.filter((line) => !line.startsWith("AUDIT-ERROR"));
	if (auditErrors.length) problems.push(...auditErrors);
	const unexpected = statements.filter(
		(line) => !ALLOWED_REMOVED_EXPECTS.some((allowed) => line.includes(allowed)),
	);
	if (unexpected.length) {
		problems.push(
			`existing expect statements changed outside the Deliberate behavior changes table: ${unexpected.join(" | ")}`,
		);
	}
	if (statements.length - unexpected.length > MAX_ALLOWED_REMOVALS) {
		problems.push(`more than the ${MAX_ALLOWED_REMOVALS} expect statement(s) this phase may change`);
	}
	const allowance = new Map();
	for (const line of ALLOWED_REMOVED_TEST_LINES) allowance.set(line, (allowance.get(line) ?? 0) + 1);
	const unexpectedTestEdits = [];
	for (const raw of audit.removedTestLines) {
		const line = raw.replace(/^-/, "").trim();
		if (line === "") continue;
		const left = allowance.get(line) ?? 0;
		if (left > 0) allowance.set(line, left - 1);
		else unexpectedTestEdits.push(line);
	}
	if (unexpectedTestEdits.length) {
		problems.push(
			`existing test lines changed that the plan doesn't list: ${unexpectedTestEdits.slice(0, 20).join(" | ")}`,
		);
	}
	if (PHASE === 2 && audit.d7ReplacementCount < 3) {
		problems.push(
			`the D7 assertions weren't replaced with "${D7_REPLACEMENT}" (found ${audit.d7ReplacementCount} of 3)`,
		);
	}
	if (audit.untouchedChanged.length) {
		problems.push(`paths the plan must not touch changed: ${audit.untouchedChanged.join(", ")}`);
	}
	if (audit.docsDrift.length && input.acceptDocsDrift !== true) {
		problems.push(
			`the plan docs changed beyond checkbox ticks (pass acceptDocsDrift: true only if the human made that edit): ${audit.docsDrift.slice(0, 20).join(" | ")}`,
		);
	}
	const strayDirty = audit.dirtyLines.filter((line) => !isDocsLine(line));
	if (strayDirty.length) problems.push(`uncommitted changes: ${strayDirty.join(" | ")}`);
	if (!audit.coverageGreen) problems.push("`bun run test:coverage` fails");
	if (!audit.checkGreen) problems.push("`bun run check` fails");
	if (!audit.lintGreen) problems.push("`bun run lint` fails");
	if (!audit.buildGreen) problems.push("`bun run build` fails");
	if (!audit.e2eGreen) problems.push("`bun run test:e2e` fails or could not run");
	if (problems.length && audit.details) problems.push(`details: ${audit.details}`);
	return problems;
}

phase("Audit");
const simplified = await agent(
	`${CONTEXT}

## Simplify this phase's changes (the pre-commit rule in .claude/CLAUDE.md, "Before Committing")
Find the phase's diff with \`cd ${REPO} && git fetch origin && git diff $(git merge-base HEAD origin/main)..HEAD ${CODE_DIFF_FILTER}\`. Scope: only code added or changed under src/ and tests/ in that diff.

Most new code in this phase is copied verbatim from the plan's task text, and must stay as it is. To tell whether a line came from the plan, grep the plan for a distinctive fragment of it.

Simplify only the remaining glue code, for clarity and consistency, without changing behavior. Leave these alone:
- regexes
- argv arrays
- precedence orders
- exported names and signatures
- test fixtures and expectations

Afterwards run \`bun run test:run\`, \`bun run check\` and \`bun run lint\`.
- If you changed something and all three pass, commit it by explicit path as \`refactor: simplify phase ${PHASE} changes\`.
- If any of them fails, revert your edits.
Report whether you changed anything.`,
	{
		label: "Audit: code-simplifier",
		phase: "Audit",
		schema: SIMPLIFY_SCHEMA,
		agentType: "code-simplifier:code-simplifier",
		model: MODELS.audit,
	},
);
if (
	simplified &&
	simplified.changed &&
	!(simplified.suiteGreen && simplified.checkGreen && simplified.lintGreen)
) {
	return wrapUpHalt("simplifier", "code-simplifier left verification red", { simplified });
}

const audit = await agent(auditPrompt(), {
	label: "Audit: assertions and verification",
	phase: "Audit",
	schema: AUDIT_SCHEMA,
	model: MODELS.audit,
});
const auditProblems = auditFailures(audit);
if (auditProblems.length) return wrapUpHalt("audit", "The audit failed", { auditProblems, audit });
const dirtyDocs = audit.dirtyLines.filter(isDocsLine);
if (dirtyDocs.length) log(`Uncommitted plan edits (checkbox ticks?): ${dirtyDocs.join(" | ")}`);

const LENSES = [
	{
		key: "regression",
		focus: `No functionality lost.
- Go through every row of the plan's Guardrail table. For each, confirm at HEAD, against both code and tests, that the behavior still holds.
- Then look for any behavior change between ${audit.mergeBase} and HEAD that the Deliberate behavior changes table doesn't list.
- Check the canary (src/lib/canary/) and its exact YouTube argv.
- Check the SSE event sequence, the error categories, and the Sentry reporting policy.`,
	},
	{
		key: "correctness",
		focus: `Bugs in the new code. Look at:
- edge cases, and empty or missing inputs
- regex behavior on real-world titles, including catastrophic backtracking on long adversarial input
- async error paths and unhandled rejections
- abort handling
- the error-reporting rules in .claude/CLAUDE.md: capture every caught failure, report an incident exactly once, and never turn an expected failure into an event`,
	},
	{
		key: "plan-fidelity",
		focus: `Does the phase as a whole implement the plan? Look for:
- steps skipped or implemented differently
- work the plan didn't ask for
- deferred items built anyway
- tests or docs the plan required but that are missing
- a Deliberate behavior changes table that no longer matches what the code does`,
	},
	{
		key: "security",
		agentType: "security-auditor",
		focus: `Security review of the phase's diff. ${
			PHASE === 2
				? "Cover:\n- SSRF and open-redirect handling in resolve-media-link.ts\n- host and path validation in soundcloud-url.ts\n- which hosts artwork is fetched from (the sndcdn.com check)\n- untrusted page JSON parsing in soundcloud-track.ts\n- filenames and ID3 values built from uploader-controlled text"
				: "Cover:\n- ReDoS in the new title regexes, which run on uploader-controlled titles\n- ID3 values and filenames built from uploader-controlled text"
		}
Don't report dependency advisories unless this phase changed package.json or bun.lock.`,
	},
];

function reviewPrompt(lens) {
	return `${CONTEXT}
${decisionsBlock()}
## Final review of Phase ${PHASE}, lens: ${lens.key}
The phase's code diff is \`git diff ${audit.mergeBase}..HEAD ${CODE_DIFF_FILTER}\`. Read it, along with any code you need around it.

${lens.focus}

Report only real problems introduced by this phase's changes. Leave out anything that predates the phase. Give each problem a file and line and concrete evidence (a code path, an input, a failing command). An empty findings list is a fine answer. Don't modify the repo or write files in it.`;
}

function refutePrompt(finding, index, angle) {
	const scratch = `tests/unit/__skeptic__/finding-${index}.test.ts`;
	const approach = [
		`Try to reproduce it. You're the only agent writing to the repo right now.
1. Start with \`rm -rf tests/unit/__skeptic__\`. Anything there is an earlier skeptic's leftover.
2. Write your throwaway test only at ${scratch}, and run only that file: \`bun run test:run ${scratch}\`. A Bun script is fine too.
3. Delete everything you created, and confirm \`git status --porcelain\` shows nothing under tests/unit/__skeptic__.`,
		"Trace the real code paths and callers at HEAD, to see whether the problem can actually happen. Only read: don't write files and don't run the test suite, because another skeptic may have a throwaway test in the repo right now. Read-only git commands are fine.",
		"Check whether it's intended: look at the plan's Deliberate behavior changes table, its Considered and deferred list, the task text, and the human decisions above. Documented, intended behavior is not a defect. Only read: don't write files and don't run the test suite.",
	][angle];
	return `${CONTEXT}
${decisionsBlock()}
## Adversarial check of one review finding
Finding (${finding.severity}, from the ${finding.lens} lens): ${finding.title}
Location: ${finding.file}${finding.line ? `:${finding.line}` : ""}
${finding.description}
The evidence offered: ${finding.evidence}

Your job is to refute this finding. ${approach}
Set refuted to true if the finding is wrong, can't be reached, is intended by the plan or by a human decision, predates this phase, or you can't confirm it. When in doubt, refute it.`;
}

phase("Final review");
const reviews = await parallel(
	LENSES.map(
		(lens) => () =>
			agent(reviewPrompt(lens), {
				label: `Review: ${lens.key}`,
				phase: "Final review",
				schema: FINDINGS_SCHEMA,
				model: MODELS.review,
				...(lens.agentType ? { agentType: lens.agentType } : {}),
			}),
	),
);
const silentLenses = LENSES.filter((_, i) => !reviews[i]).map((l) => l.key);

const findingsByKey = new Map();
let mergedFindings = 0;
reviews.forEach((review, i) => {
	for (const finding of review ? review.findings : []) {
		const key = `${finding.file}:${finding.line ?? ""}:${finding.title.trim().toLowerCase()}:${finding.line == null ? finding.description : ""}`;
		const existing = findingsByKey.get(key);
		if (existing) mergedFindings++;
		if (!existing || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
			findingsByKey.set(key, { ...finding, lens: LENSES[i].key });
		}
	}
});
const allFindings = [...findingsByKey.values()];
if (mergedFindings) log(`${mergedFindings} duplicate finding(s) merged, keeping the most severe copy`);
const serious = allFindings.filter((f) => f.severity !== "minor");
const minor = allFindings.filter((f) => f.severity === "minor");
log(
	`${allFindings.length} finding(s): ${serious.length} going to three skeptics each; ${minor.length} minor (reported only, not verified or fixed)`,
);

const verdictOpts = (finding, angle) => ({
	label: `Verify: ${finding.title.slice(0, 48)} (${angle + 1}/3)`,
	phase: "Final review",
	schema: VERDICT_SCHEMA,
	model: MODELS.verify,
});
const [readOnlyVotes, reproVotes] = await Promise.all([
	parallel(
		serious.map(
			(finding, index) => () =>
				parallel(
					[1, 2].map(
						(angle) => () =>
							agent(refutePrompt(finding, index, angle), verdictOpts(finding, angle)),
					),
				),
		),
	),
	(async () => {
		const votes = [];
		for (let index = 0; index < serious.length; index++) {
			const finding = serious[index];
			votes.push(await agent(refutePrompt(finding, index, 0), verdictOpts(finding, 0)));
		}
		return votes;
	})(),
]);
const judged = serious.map((finding, i) => {
	const votes = [...(readOnlyVotes[i] ?? []), reproVotes[i]].filter(Boolean);
	const upholds = votes.filter((v) => !v.refuted).length;
	return {
		finding,
		upheld: upholds >= 2,
		couldStillPass: upholds < 2 && upholds + (3 - votes.length) >= 2,
		reasons: votes.map((v) => v.reasoning),
	};
});
const confirmed = judged.filter((j) => j.upheld).map((j) => j.finding);
const rejected = judged
	.filter((j) => !j.upheld && !j.couldStillPass)
	.map((j) => ({ title: j.finding.title, reasons: j.reasons }));
const unverified = judged.filter((j) => j.couldStillPass).map((j) => j.finding);

const cleanup = await agent(
	`${CONTEXT}

## Clean up after the skeptics
Run \`cd ${REPO} && rm -rf tests/unit/__skeptic__ && git status --porcelain\`, and return every status line.`,
	{
		label: "Clean up skeptic files",
		phase: "Final review",
		schema: STATUS_SCHEMA,
		model: MODELS.audit,
		effort: "low",
	},
);

const finalReview = { confirmed, rejected, unverified, minor, silentLenses };
const reviewGaps = [];
if (!simplified) reviewGaps.push("code-simplifier returned nothing");
if (silentLenses.length) {
	reviewGaps.push(`final-review lens(es) returned nothing: ${silentLenses.join(", ")}`);
}
if (unverified.length) {
	reviewGaps.push(
		`finding(s) whose missing skeptic verdicts could have upheld them: ${unverified.map((f) => f.title).join(" | ")}`,
	);
}
if (!cleanup) reviewGaps.push("the skeptic clean-up agent returned nothing");
else {
	const leftovers = cleanup.statusLines.filter((line) => !isDocsLine(line));
	if (leftovers.length) reviewGaps.push(`files left in the worktree: ${leftovers.join(" | ")}`);
}
if (reviewGaps.length) {
	return wrapUpHalt("review-gap", "Part of the final review did not complete", {
		reviewGaps,
		finalReview,
	});
}

function summary(extra) {
	return {
		halted: false,
		phase: PHASE,
		baselineTests:
			input.baselineTests ??
			allResults.find((r) => r.task === PHASE_RANGE[0])?.baselineTestResults ??
			"not in this run's results",
		tasks: allResults.map((r) => ({
			task: r.task,
			title: r.title,
			commits: `${r.taskBase.slice(0, 7)}..${r.headSha.slice(0, 7)}`,
			testResults: r.testResults,
			concerns: r.concerns,
			planConflicts: r.planConflicts,
			minorIssues: r.minorIssues,
		})),
		audit: {
			mergeBase: audit.mergeBase,
			removedExpectLines: audit.removedExpectLines,
			uncommittedPlanEdits: dirtyDocs,
		},
		simplifier: simplified.summary,
		finalReview,
		nextForController:
			PHASE === 1
				? "Task 7 Steps 3–4: the real YouTube check, then the PR once the human approves"
				: "Task 20 Steps 3–6: real-track checks, the PR and its PR-environment check, and production after the human merges",
		...extra,
	};
}

if (confirmed.length === 0) return summary({ fixes: "none needed" });

phase("Fix");
const fixList = confirmed
	.map(
		(f, i) =>
			`${i + 1}. [${f.severity}, ${f.lens}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.title}\n   ${f.description}\n   Evidence: ${f.evidence}`,
	)
	.join("\n");
const fixes = await agent(
	`${CONTEXT}
${decisionsBlock()}
## Fix confirmed final-review findings for Phase ${PHASE}
Each of these survived three independent attempts to refute it:
${fixList}

1. Fix each finding test-first: write a failing test that shows the problem, then make it pass. The hard rules still apply.
2. If a fix would depart from the plan's decisions or undo a human decision, don't make it. Explain why in concerns, and report DONE_WITH_CONCERNS.
3. Run \`bun run test:run\`, \`bun run check\` and \`bun run lint\`.
4. Commit each fix separately, staging by explicit path, and only when all three pass. If you can't get them green, don't commit; report BLOCKED with the failing test names.`,
	{
		label: `Fix ${confirmed.length} confirmed finding(s)`,
		phase: "Fix",
		schema: WORK_SCHEMA,
		model: MODELS.escalate,
	},
);

const fixReview =
	fixes && (fixes.status === "DONE" || fixes.status === "DONE_WITH_CONCERNS")
		? await agent(
				`${CONTEXT}
${decisionsBlock()}
## Code quality review of the final-review fixes
Review \`git diff ${audit.headSha}..HEAD ${CODE_DIFF_FILTER}\`. It is meant to fix these findings:
${fixList}
The fixer's concerns: ${fixes.concerns.join("; ") || "none"}.
Check three things: each fix really resolves its finding, the new tests fail without the fix, and nothing else changed. ${VERIFY_STEPS} Set conflictsWithPlan: true on any issue whose fix would depart from the plan.`,
				{
					label: "Review the fixes",
					phase: "Fix",
					schema: QUALITY_SCHEMA,
					model: MODELS.qualityReview,
					agentType: "superpowers:code-reviewer",
				},
			)
		: null;

const recheck = await agent(auditPrompt(), {
	label: "Re-audit after fixes",
	phase: "Fix",
	schema: AUDIT_SCHEMA,
	model: MODELS.audit,
});

const fixProblems = [];
if (!fixes) fixProblems.push("the fixer returned nothing");
else if (fixes.status === "NEEDS_CONTEXT" || fixes.status === "BLOCKED") {
	fixProblems.push(`the fixer reported ${fixes.status}: ${fixes.questions.join("; ")}`);
}
if (fixes && fixReview === null && fixProblems.length === 0) {
	fixProblems.push("the fix reviewer returned nothing");
}
if (fixReview) {
	for (const issue of blockingIssues("quality", fixReview)) {
		fixProblems.push(`fix review: ${issue.description}`);
	}
}
fixProblems.push(...auditFailures(recheck).map((p) => `re-audit: ${p}`));

const fixOutcome = {
	fixes: fixes
		? { status: fixes.status, summary: fixes.summary, concerns: fixes.concerns }
		: "the fixer returned nothing",
	fixReview: fixReview ? { approved: fixReview.approved, issues: fixReview.issues } : null,
};
if (fixProblems.length) {
	return wrapUpHalt("fix-phase", "Fixing the confirmed findings did not end clean", {
		fixProblems,
		finalReview,
		...fixOutcome,
	});
}
return summary(fixOutcome);
```
