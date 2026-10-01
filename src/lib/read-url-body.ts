export async function readUrlFromBody(
	request: Request,
): Promise<string | null> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return null;
	}
	if (typeof body !== "object" || body === null) return null;
	const { url } = body as { url?: unknown };
	return typeof url === "string" && url.trim() !== "" ? url : null;
}
