declare namespace Cloudflare {
	interface Env {
		readonly SHOPIFY_API_VERSION: string;
	}
}
interface Env extends Cloudflare.Env {}
