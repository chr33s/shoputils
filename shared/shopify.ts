import type { I18nFormatModule, InitOptions, LanguageDetectorModule, LoggerModule, Services, TOptions } from "i18next";
import { isValidElement, cloneElement } from 'react';

import { createFetcher } from "./fetch";
import { merge } from "./utils";

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
}

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

export class ShopifyI18nFormat implements I18nFormatModule {
	i18next: Services["i18nFormat"];
	name = "shopifyFormat" as const;
	options : TOptions;
	type = "i18nFormat" as const;

	readonly #MUSTACHE_FORMAT = /{{?\s*(\w+)\s*}}?/g;

	constructor(_services: Services, initOptions: InitOptions) {
		this.init(null, initOptions);
	}

	init(services: Services, initOptions: InitOptions) {
		this.i18next = services.i18nFormat;
		this.options = merge(
			{ ...services.i18nFormat.options },
			{ ...initOptions, ...this.options },
		);
	}

	addLookupKeys(
		finalKeys: string[],
		key: string,
		code: string,
		_ns: string,
		options: TOptions & { count?: number; ordinal?: number }
	) {
		const needsPluralHandling = Boolean(
			(options.count !== undefined && typeof options.count !== 'string') ||
				typeof options.ordinal === 'number',
		);

		if (needsPluralHandling) {
			if (!Intl) {
				throw new Error(
					'Error: The application was unable to use the Intl API, likely due to a missing or incomplete polyfill.',
				);
			}

			const needsOrdinalHandling = Boolean(
				options.ordinal ||
					(options.ordinal === 0 && options.count === undefined),
			);

			const pluralRule = this.i18next.translator.pluralResolver.getRule(code, {
				...options,
				ordinal: needsOrdinalHandling,
			});

			if (needsOrdinalHandling) {
				const ruleName = pluralRule.select(
					options.count === undefined ? options.ordinal : options.count,
				);
				const pluralSuffix = `${this.i18next.options.keySeparator}ordinal${this.i18next.options.keySeparator}${ruleName}`;
				finalKeys.push(key + pluralSuffix);
			} else {
				const ruleName = pluralRule.select(options.count);

				// Fallback to "other" key
				if (ruleName !== 'other') {
					const otherSubkey = `${this.i18next.options.keySeparator}other`;
					finalKeys.push(key + otherSubkey);
				}

				// Pluralization rule key
				const pluralSuffix = `${this.i18next.options.keySeparator}${ruleName}`;
				finalKeys.push(key + pluralSuffix);

				// Explicit "0" and "1" keys
				if (options.count === 0) {
					const explicit0Subkey = `${this.i18next.options.keySeparator}0`;
					finalKeys.push(key + explicit0Subkey);
				} else if (options.count === 1) {
					const explicit1Subkey = `${this.i18next.options.keySeparator}1`;
					finalKeys.push(key + explicit1Subkey);
				}
			}
		}

		return finalKeys;
	}

	parse(res: string | Record<string, any> | null, options: TOptions) {
		if (res === null) return res;

		if (typeof res === 'object') {
			return Object.entries(res).reduce((acc, [key, value]) => {
				acc[key] = this.parse(value, options);
				return acc;
			}, {} as Record<string, any>);
		}

		// Interpolations
		const matches = res.match(this.#MUSTACHE_FORMAT);
		if (!matches) return res;

		let interpolated: string | object | object[] = res;
		matches.forEach((match) => {
			const interpolationKey = match.replace(this.#MUSTACHE_FORMAT, '$1');

			let value =
				interpolationKey === 'ordinal'
					? options.count || options.ordinal
					: options[interpolationKey];

			if (
				(interpolationKey === 'ordinal' || interpolationKey === 'count') &&
				typeof value === 'number'
			) {
				value = new Intl.NumberFormat(this.i18next.resolvedLanguage).format(
					value,
				);
			}

			interpolated = this.#replaceValue(interpolated, match, value as string ?? '');
		});
		return interpolated;
	}

	#replaceValue(
		interpolated: string | Record<string, any> | Array<Record<string, any>>,
		pattern: string | RegExp,
		replacement: string | Record<string, any> | Array<Record<string, any>>,
	): string | Record<string, any> | Array<Record<string, any>> {
		switch (typeof interpolated) {
			case 'string': {
				const split = interpolated.split(pattern);
				// Check if interpolated includes pattern && if String.prototype.replace wouldn't work because replacement is an object like a React element.
				if (split.length !== 1 && typeof replacement === 'object') {
					if (!('key' in replacement) && isValidElement(replacement)) {
						replacement = cloneElement(replacement, { key: pattern.toString() });
					}

					return [split[0], replacement, split[1]].flat();
				}

				return interpolated.replace(pattern, replacement as string);
			}

			case 'object':
				if (Array.isArray(interpolated)) {
					return interpolated
						.map((item: any) => this.#replaceValue(item, pattern, replacement))
						.flat();
				}

				if (interpolated?.props?.children) {
					const children = this.#replaceValue(
						interpolated.props.children,
						pattern,
						replacement,
					);

					if (children !== interpolated.props.children) {
						return {
							...interpolated,
							props: {...interpolated.props, children: children},
						};
					}
				}
		}

		return interpolated;
	}
}

export class ShopifyI18nLanguageDetector implements LanguageDetectorModule {
	name = "shopifyLanguageDetector" as const;
	type = "languageDetector" as const;

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

	detect() {
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

export type I18nLogger = { [K in "error" | "log" | "warn"]: (...args: unknown[]) => void };

export class ShopifyI18nLogger implements LoggerModule {
	public name = "shopifyLogger" as const;
	public type = "logger" as const;

	#logger: I18nLogger;

	constructor(options: TOptions & { logger: I18nLogger }) {
		this.#logger = options.logger;
	}

	error(...args: unknown[]) {
		this.#logger.error(...args);
	}

	log(args: unknown[]) {
		this.#logger.log(...args);
	}

	warn(args: unknown[]) {
		this.#logger.warn(...args);
	}
}

export * from "#shared/shopify";
