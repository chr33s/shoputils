import type { InitOptions, LanguageDetectorModule, Services } from "i18next";

import { createFetcher } from "./fetch";

export interface ClientProps extends RequestInit {
	apiVersion?: string;
	shop: string;
	token: string;
	type: 'admin' | 'customer' | 'storefront';
}

export interface ClientRequest {
	operationName?: string;
	query: string;
	variables?: Record<string, any>;
}

export interface ClientResponse<T = any> {
	data: T;
	errors: any[];
	message: string;
}

export function createClient(props: ClientProps) {
	const fetcher = createFetcher(props);

	return async <T = any>(body: ClientRequest) => {
		const { auth, url } = parse(props);
		const response = await fetcher(url, {
			body: JSON.stringify(body),
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...auth,
			},
			method: 'POST',
		});
		return response.json() satisfies Promise<ClientResponse<T>>;
	}

	function parse(props: ClientProps) {
		const apiVersion = props.apiVersion ?? 'latest';

		const header = {
			admin: 'X-Shopify-Access-Token',
			customer: 'Authorization',
			storefront: 'X-Shopify-Storefront-Access-Token',
		}[props.type];
		const auth = { [header]: `${props.type === 'customer' ? 'Bearer ' : ''}` };

		const url = {
			admin: `https://${props.shop}/admin/api/${apiVersion}/graphql.json`,
			customer: `https://shopify.com/${props.shop}/account/customer/api/${apiVersion}/graphql.json`,
			storefront: `https://${props.shop}/api/${apiVersion}/graphql.json`,
		}[props.type];

		return { auth, url };
	}
};

export interface DetectorOptions {
	headers: Headers;
	searchParams: URLSearchParams;
}

export const gid = {
	decode(gid: GID) {
		const parts = gid.split('/');
		return {
			id: parts.at(-1),
			ownerType: parts.at(-2),
		};
	},

	encode(ownerType: string, id: string): GID {
		return `gid://shopify/${ownerType}/${id}`;
	},
};

type GID = `gid://shopify/${string}/${string}`;

export class ShopifyLanguageDetector implements LanguageDetectorModule {
	public type = "languageDetector" as const;

	readonly defaultLocale = 'en';
	readonly #options?: DetectorOptions;
	readonly #i18n?: InitOptions;

	constructor(
		_services: Services,
		detectorOptions: DetectorOptions,
		initOptions: InitOptions,
	) {
		this.#options = detectorOptions;
		this.#i18n = initOptions;
	}

	public detect() {
		let locale: string | null | undefined;

		const param = 'locale';
		if (this.#options.searchParams.has(param)) {
		 // shopify admin
			locale = this.#options.searchParams.get(param);
		}

		const header = 'accept-language';
		if (!locale && this.#options?.headers.has(header)) {
			// shopify storefront
			locale = this.#options.headers
				.get(header)
				?.match(/[a-z-_]{2,5}/i)
				?.at(0);
		}
		locale = locale?.split('-').at(0);

		const supportedLngs = this.#i18n.supportedLngs || [];
		if (locale && !supportedLngs.includes(locale)) {
			locale = null;
		}

		if (!locale) {
			const fallbackLng = this.#i18n.fallbackLng;
			locale = Array.isArray(fallbackLng) ? fallbackLng[0] : fallbackLng;
		}
		return locale ?? this.defaultLocale;
	}
}

export * from "#shared/shopify";
