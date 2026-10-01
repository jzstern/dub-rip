import * as Sentry from "@sentry/sveltekit";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

import { POST as postPreview } from "../../../src/routes/api/preview/+server";
import { POST as postDetails } from "../../../src/routes/api/preview/details/+server";

type AnyHandler = (event: never) => Response | Promise<Response>;

const ROUTES: [string, AnyHandler][] = [
	["/api/preview", postPreview],
	["/api/preview/details", postDetails],
];

function eventWithBody(body: string): never {
	return {
		request: new Request("http://localhost/api", {
			method: "POST",
			body,
			headers: { "Content-Type": "application/json" },
		}),
	} as never;
}

const MALFORMED_BODIES: [string, string][] = [
	["invalid JSON", "{not json"],
	["an empty body", ""],
	["a non-string url", JSON.stringify({ url: 42 })],
	["an object url", JSON.stringify({ url: { href: "x" } })],
	["a blank url", JSON.stringify({ url: "   " })],
	["a null body", "null"],
	["an array body", "[]"],
];

describe.each(ROUTES)("POST %s - malformed request body", (_name, handler) => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(MALFORMED_BODIES)("answers %s with a 400", async (_label, body) => {
		// #given
		const event = eventWithBody(body);

		// #when
		const response = await handler(event);

		// #then
		expect(response.status).toBe(400);
	});

	it.each(
		MALFORMED_BODIES,
	)("files no Sentry event for %s", async (_label, body) => {
		// #given
		const event = eventWithBody(body);

		// #when
		await handler(event);

		// #then
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});
});
