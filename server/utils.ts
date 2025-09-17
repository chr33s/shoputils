import { type JWTPayload, jwtVerify } from "jose";

export function verify(request: Request) {
	async function hmac({
		from,
		secret,
	}: {
		from: "header" | "url";
		secret: string;
	}) {
		const url = new URL(request.url);

		async function get() {
			switch (from) {
				case "header": {
					const data = await request.clone().text();
					const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
					const encoding = "base64" as const;
					return { data, encoding, hmac };
				}

				case "url": {
					const data = Object.entries(Object.fromEntries(url.searchParams))
						.filter(([key]) => key !== "signature")
						.map(
							([key, value]) =>
								`${key}=${Array.isArray(value) ? value.join(",") : value}`,
						)
						.sort((a, b) => a.localeCompare(b))
						.join("");
					const encoding = "hex" as const;
					const hmac = url.searchParams.get("signature");
					return { data, encoding, hmac };
				}

				default:
					return {} as never;
			}
		}
		const { data, encoding, hmac } = await get();

		// HMAC_TIMESTAMP_PERMITTED_CLOCK_TOLERANCE_SEC
		const timestamp = Number(url.searchParams.get("timestamp"));
		if (timestamp && Math.abs(Math.trunc(Date.now() / 1000) - timestamp) > 90) return null;

		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{
				hash: "SHA-256",
				name: "HMAC",
			},
			false,
			["sign"],
		);
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(data),
		);

		const computed = encode(signature, encoding);
		const bufA = encoder.encode(computed);
		const bufB = encoder.encode(hmac);
		if (bufA.byteLength !== bufB.byteLength) return false;

		const valid = (crypto.subtle as any).timingSafeEqual(bufA, bufB) as boolean;
		return valid;
	}

	async function token({ key, secret }: Record<"key" | "secret", string>) {
		const encoded =
			request.headers.get("authorization")?.replace("Bearer ", "") ||
			new URL(request.url).searchParams.get("id_token");
		if (!encoded) return null;

		const { payload: decoded } = await jwtVerify<JWTPayload & { dest: string }>(
			encoded,
			new TextEncoder().encode(secret),
			{
				algorithms: ["HS256"],
				clockTolerance: 10,
			},
		);

		// The exp and nbf fields are validated by the JWT library
		if (decoded.aud !== key) return null;
		return decoded;
	}

	return { hmac, token };
}

export function encode(value: ArrayBuffer, encoding: "base64" | "hex") {
	switch (encoding) {
		case "base64":
			return btoa(String.fromCharCode(...new Uint8Array(value)));

		case "hex":
			return [...new Uint8Array(value)].reduce(
				(a, b) => a + b.toString(16).padStart(2, "0"),
				"",
			);
	}
}

export * from "#shared/utils";
