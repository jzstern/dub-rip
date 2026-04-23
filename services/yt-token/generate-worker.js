import { generate } from "youtube-po-token-generator";

async function main() {
	try {
		const token = await generate();
		if (
			!token ||
			typeof token.poToken !== "string" ||
			typeof token.visitorData !== "string"
		) {
			process.stdout.write(
				`${JSON.stringify({ ok: false, error: "Generator returned invalid token structure" })}\n`,
			);
			process.exit(1);
		}
		process.stdout.write(`${JSON.stringify({ ok: true, token })}\n`);
		process.exit(0);
	} catch (err) {
		process.stdout.write(
			`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`,
		);
		process.exit(1);
	}
}

main();
