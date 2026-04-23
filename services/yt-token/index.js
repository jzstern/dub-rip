import http from "node:http";
import { generate } from "youtube-po-token-generator";

const PORT = process.env.PORT || 8080;
const CACHE_TTL_MS = 60 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 30_000;
const FAILURE_BACKOFF_MS = 30_000;
const SHUTDOWN_GRACE_MS = 10_000;
const PROACTIVE_REFRESH_MS = 10 * 60 * 1000;
const BACKGROUND_MIN_INTERVAL_MS = 30_000;
const BACKGROUND_MAX_INTERVAL_MS = 5 * 60 * 1000;

let cachedToken = null;
let lastGenerated = 0;
let lastFailedAt = 0;
let lastError = null;
let lastErrorAt = 0;
let generationAttempts = 0;
let generationSuccesses = 0;
let isGenerating = false;
let generationPromise = null;
let backgroundTimer = null;

function log(message) {
	console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(context, err) {
	const message = err?.message ?? String(err);
	const stack = err?.stack ?? "(no stack)";
	const cause = err?.cause ? `\n  cause: ${err.cause}` : "";
	console.error(
		`[${new Date().toISOString()}] ${context}: ${message}${cause}\n${stack}`,
	);
}

async function generateToken() {
	generationAttempts += 1;
	log(`Generating new token (attempt #${generationAttempts})...`);
	const startTime = Date.now();

	let timeoutId;
	const timeoutPromise = new Promise((_, reject) => {
		timeoutId = setTimeout(
			() => reject(new Error("Token generation timed out")),
			GENERATION_TIMEOUT_MS,
		);
	});

	const generatePromise = generate();
	generatePromise.catch(() => {});

	try {
		const result = await Promise.race([generatePromise, timeoutPromise]);
		log(`Token generated in ${Date.now() - startTime}ms`);
		return result;
	} finally {
		clearTimeout(timeoutId);
	}
}

function isValidToken(token) {
	return (
		token &&
		typeof token.poToken === "string" &&
		typeof token.visitorData === "string"
	);
}

async function getToken({ forceRefresh = false } = {}) {
	const now = Date.now();

	if (!forceRefresh && cachedToken && now - lastGenerated < CACHE_TTL_MS) {
		const age = Math.round((now - lastGenerated) / 1000);
		log(`Returning cached token (age: ${age}s)`);
		return cachedToken;
	}

	if (isGenerating && generationPromise) {
		log("Waiting for ongoing generation...");
		return generationPromise;
	}

	if (lastFailedAt && now - lastFailedAt < FAILURE_BACKOFF_MS) {
		if (cachedToken) {
			log("In backoff period, returning stale cached token");
			return cachedToken;
		}
		throw new Error("Token generation in backoff period after failure");
	}

	isGenerating = true;
	generationPromise = generateToken()
		.then((result) => {
			if (!isValidToken(result)) {
				throw new Error("Generator returned invalid token structure");
			}
			cachedToken = result;
			lastGenerated = Date.now();
			lastFailedAt = 0;
			lastError = null;
			generationSuccesses += 1;
			return result;
		})
		.catch((err) => {
			logError("Token generation failed", err);
			lastFailedAt = Date.now();
			lastError = err;
			lastErrorAt = Date.now();
			if (cachedToken) {
				log("Returning stale cached token");
				return cachedToken;
			}
			throw err;
		})
		.finally(() => {
			isGenerating = false;
			generationPromise = null;
		});

	return generationPromise;
}

function computeNextRefreshDelay() {
	if (!cachedToken) {
		return BACKGROUND_MIN_INTERVAL_MS;
	}
	const age = Date.now() - lastGenerated;
	const timeToExpiry = CACHE_TTL_MS - age;
	const untilProactiveRefresh = timeToExpiry - PROACTIVE_REFRESH_MS;
	return Math.max(
		Math.min(untilProactiveRefresh, BACKGROUND_MAX_INTERVAL_MS),
		BACKGROUND_MIN_INTERVAL_MS,
	);
}

function scheduleBackgroundRefresh() {
	if (backgroundTimer) clearTimeout(backgroundTimer);
	const delay = computeNextRefreshDelay();
	log(`Next background refresh in ${Math.round(delay / 1000)}s`);
	backgroundTimer = setTimeout(async () => {
		try {
			const inProactiveWindow =
				!!cachedToken &&
				Date.now() - lastGenerated >= CACHE_TTL_MS - PROACTIVE_REFRESH_MS;
			await getToken({ forceRefresh: inProactiveWindow });
		} catch {
			// logged in getToken
		} finally {
			scheduleBackgroundRefresh();
		}
	}, delay);
	backgroundTimer.unref?.();
}

const NO_CACHE_HEADERS = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store, max-age=0",
};

function writeJson(res, status, body) {
	res.writeHead(status, NO_CACHE_HEADERS);
	res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
	let pathname;
	try {
		pathname = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "localhost"}`,
		).pathname;
	} catch {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Bad Request");
		return;
	}

	const isGetPotPost = req.method === "POST" && pathname === "/get_pot";

	if (req.method !== "GET" && req.method !== "HEAD" && !isGetPotPost) {
		res.writeHead(405, {
			"Content-Type": "text/plain",
			Allow: "GET, HEAD, POST",
		});
		res.end("Method Not Allowed");
		return;
	}

	if (pathname === "/health" || pathname === "/healthz") {
		writeJson(res, 200, { status: "ok", cached: !!cachedToken });
		return;
	}

	if (pathname === "/ready") {
		const ready = !!cachedToken;
		writeJson(res, ready ? 200 : 503, {
			status: ready ? "ready" : "not_ready",
			cached: ready,
		});
		return;
	}

	if (pathname === "/status") {
		const now = Date.now();
		writeJson(res, 200, {
			cached: !!cachedToken,
			tokenAgeMs: cachedToken ? now - lastGenerated : null,
			tokenTtlRemainingMs: cachedToken
				? Math.max(CACHE_TTL_MS - (now - lastGenerated), 0)
				: null,
			lastFailedAtMs: lastFailedAt ? now - lastFailedAt : null,
			inBackoff: !!lastFailedAt && now - lastFailedAt < FAILURE_BACKOFF_MS,
			isGenerating,
			generationAttempts,
			generationSuccesses,
			lastError: lastError
				? {
						message: lastError.message,
						ageMs: now - lastErrorAt,
					}
				: null,
		});
		return;
	}

	if (pathname === "/token" || pathname === "/" || pathname === "/get_pot") {
		log(`${req.method} ${req.url} from ${req.socket.remoteAddress}`);

		try {
			const token = await getToken();
			writeJson(res, 200, {
				potoken: token.poToken,
				visitor_data: token.visitorData,
				updated: Date.now(),
			});
		} catch (err) {
			logError("Request failed", err);
			res.writeHead(503, {
				"Content-Type": "text/plain",
				"Cache-Control": "no-store",
			});
			res.end(`Token generation failed: ${err?.message ?? "unknown"}`);
		}
		return;
	}

	res.writeHead(404, { "Content-Type": "text/plain" });
	res.end("Not found");
});

async function warmup() {
	log("Warming up token cache...");
	try {
		await getToken();
		log("Warmup complete");
	} catch (err) {
		logError("Warmup failed (will retry in background)", err);
	}
}

function shutdown() {
	log("Shutting down...");
	if (backgroundTimer) clearTimeout(backgroundTimer);
	server.close(() => {
		log("Server closed");
		process.exit(0);
	});
	setTimeout(() => {
		console.error("Forced shutdown after grace period");
		process.exit(1);
	}, SHUTDOWN_GRACE_MS).unref();
}

server.on("error", (err) => {
	logError("Server error", err);
	process.exit(1);
});

process.on("uncaughtException", (err) => {
	logError("Uncaught exception", err);
});

process.on("unhandledRejection", (reason) => {
	logError("Unhandled rejection", reason);
});

server.listen(PORT, () => {
	log(`yt-token-service listening on port ${PORT}`);
	log(
		"Endpoints: /token, /get_pot (POST, for Cobalt 11.7+), /health (liveness), /ready, /status",
	);
	warmup().finally(() => scheduleBackgroundRefresh());
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
