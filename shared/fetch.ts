import {merge} from './utils';

export function createFetcher(props: RequestInit) {
	return async function fetcher(input: RequestInfo | URL, init?: RequestInit) {
		const request = () => fetch(input, merge(props, init as object));
		let response = await request();
		if (!response.ok) {
			if (response.status === 429) await rateLimit(response);
			if (response.status >= 500) {
				response = await retry(request);
			}
		}
		return response;
	}

	async function rateLimit(response: Response) {
		const retryAfter = response.headers.get('Retry-After');
		const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
		await wait(waitTime);
	}

	async function retry(request: () => Promise<Response>, { attempts, delay } = { attempts: 3, delay: 100 }) {
		let attempt = 0;
		let ms = 0;

		while(true) {
			let response: Response;
			try {
				response = await request();
				if (response.status > 500) throw new Error('Retry');
				return response;
			} catch {
				if (++attempt >= attempts) return response;

				ms = delay * 2 ** attempt;
				ms = ms / 2 + (Math.random() * ms) / 2;
				await wait(ms);
			}
		}
	}

	async function wait(ms: number) {
		return await new Promise((resolve) => setTimeout(resolve, ms));
	}
}