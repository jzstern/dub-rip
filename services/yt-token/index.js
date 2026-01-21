import http from "node:http";
import { generate } from "youtube-po-token-generator";

const PORT = process.env.PORT || 8080;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache (tokens valid for 12+ hours)
const GENERATION_TIMEOUT_MS = 30000; // 30 second timeout for token generation

let cachedToken = null;
let lastGenerated = 0;
let isGenerating = false;
let generationPromise = null;

async function generateToken() {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

	try {
		console.log(`[${new Date().toISOString()}] Generating new token...`);
		const startTime = Date.now();
		const result = await generate();
		const duration = Date.now() - startTime;
		console.log(`[${new Date().toISOString()}] Token generated in ${duration}ms`);
		return result;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function getToken() {
	const now = Date.now();

	if (cachedToken && now - lastGenerated < CACHE_TTL_MS) {
		const age = Math.round((now - lastGenerated) / 1000);
		console.log(`[${new Date().toISOString()}] Returning cached token (age: ${age}s)`);
		return cachedToken;
	}

	if (isGenerating && generationPromise) {
		console.log(`[${new Date().toISOString()}] Waiting for ongoing generation...`);
		return generationPromise;
	}

	isGenerating = true;
	generationPromise = generateToken()
		.then((result) => {
			cachedToken = result;
			lastGenerated = Date.now();
			return result;
		})
		.catch((err) => {
			console.error(`[${new Date().toISOString()}] Token generation failed:`, err.message);
			if (cachedToken) {
				console.log(`[${new Date().toISOString()}] Returning stale cached token`);
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

const server = http.createServer(async (req, res) => {
	const timestamp = new Date().toISOString();

	if (req.url === "/health" || req.url === "/healthz") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", cached: !!cachedToken }));
		return;
	}

	if (req.url === "/token" || req.url === "/") {
		console.log(`[${timestamp}] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

		try {
			const token = await getToken();

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					poToken: token.poToken,
					visitor_data: token.visitorData,
				})
			);
		} catch (err) {
			console.error(`[${timestamp}] Error:`, err.message);
			res.writeHead(503, { "Content-Type": "text/plain" });
			res.end(`Token generation failed: ${err.message}`);
		}
		return;
	}

	res.writeHead(404, { "Content-Type": "text/plain" });
	res.end("Not found");
});

async function warmup() {
	console.log(`[${new Date().toISOString()}] Warming up token cache...`);
	try {
		await getToken();
		console.log(`[${new Date().toISOString()}] Warmup complete`);
	} catch (err) {
		console.error(`[${new Date().toISOString()}] Warmup failed:`, err.message);
	}
}

server.listen(PORT, () => {
	console.log(`[${new Date().toISOString()}] yt-token-service listening on port ${PORT}`);
	console.log(`[${new Date().toISOString()}] Endpoints: /token, /health`);
	warmup();
});

process.on("SIGTERM", () => {
	console.log(`[${new Date().toISOString()}] Received SIGTERM, shutting down...`);
	server.close(() => {
		console.log(`[${new Date().toISOString()}] Server closed`);
		process.exit(0);
	});
});
