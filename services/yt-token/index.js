import http from "node:http";
import { generate } from "youtube-po-token-generator";

const PORT = process.env.PORT || 8080;
const CACHE_TTL_MS = 60 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 30_000;
const FAILURE_BACKOFF_MS = 30_000;
const SHUTDOWN_GRACE_MS = 10_000;

let cachedToken = null;
let lastGenerated = 0;
let lastFailedAt = 0;
let isGenerating = false;
let generationPromise = null;

function log(message) {
	console.log(`[${new Date().toISOString()}] ${message}`);
}

async function generateToken() {
	log("Generating new token...");
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

async function getToken() {
	const now = Date.now();

	if (cachedToken && now - lastGenerated < CACHE_TTL_MS) {
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
			return result;
		})
		.catch((err) => {
			console.error(
				`[${new Date().toISOString()}] Token generation failed:`,
				err.message,
			);
			lastFailedAt = Date.now();
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

const NO_CACHE_HEADERS = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store, max-age=0",
};

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

	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, {
			"Content-Type": "text/plain",
			Allow: "GET, HEAD",
		});
		res.end("Method Not Allowed");
		return;
	}

	if (pathname === "/health" || pathname === "/healthz") {
		const status = cachedToken ? 200 : 503;
		res.writeHead(status, NO_CACHE_HEADERS);
		res.end(
			JSON.stringify({
				status: cachedToken ? "ok" : "unavailable",
				cached: !!cachedToken,
			}),
		);
		return;
	}

	if (pathname === "/token" || pathname === "/") {
		log(`${req.method} ${req.url} from ${req.socket.remoteAddress}`);

		try {
			const token = await getToken();
			res.writeHead(200, NO_CACHE_HEADERS);
			res.end(
				JSON.stringify({
					poToken: token.poToken,
					visitor_data: token.visitorData,
				}),
			);
		} catch (err) {
			console.error(`[${new Date().toISOString()}] Error:`, err.message);
			res.writeHead(503, {
				"Content-Type": "text/plain",
				"Cache-Control": "no-store",
			});
			res.end(`Token generation failed: ${err.message}`);
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
		console.error(`[${new Date().toISOString()}] Warmup failed:`, err.message);
	}
}

function shutdown() {
	log("Shutting down...");
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
	console.error(`[${new Date().toISOString()}] Server error: ${err.message}`);
	process.exit(1);
});

server.listen(PORT, () => {
	log(`yt-token-service listening on port ${PORT}`);
	log("Endpoints: /token, /health");
	warmup();
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
