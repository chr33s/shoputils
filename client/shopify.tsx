import { use } from "react";

import { createClient, type ClientProps } from "#shared/shopify";

export function useClient(props: ClientProps) {
	const url = new URL(window.location.href);
	const token = use(window.shopify.idToken());
	return createClient({
		shop: url.searchParams.get("shop"),
		token,
		type: "admin",
		...props,
	});
}

export * from "#shared/shopify";
