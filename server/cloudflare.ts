import type { R2Bucket } from "@cloudflare/workers-types";
import type {
	FileKey,
	FileMetadata,
	FileStorage,
	ListOptions,
	ListResult,
} from "@remix-run/file-storage";

export namespace R2FileStorage {
	export interface CustomMetadata extends Record<string, string> {
		name: string;
		type: string;
	}
}

export class R2FileStorage implements FileStorage {
	#bucket: R2Bucket;

	constructor(bucket: R2Bucket) {
		this.#bucket = bucket;
	}

	async get(key: string) {
		const object = await this.#bucket.get(key);
		if (!object) return null;

		const buffer = await object.arrayBuffer();
		const metadata =
			object.customMetadata as unknown as R2FileStorage.CustomMetadata;

		return new File([buffer], metadata?.name ?? key, {
			lastModified: object.uploaded.getTime(),
			type: object.httpMetadata?.contentType ?? metadata?.type,
		});
	}

	async has(key: string) {
		const object = await this.#bucket.get(key);
		return object !== null;
	}

	async list<T extends ListOptions>(options?: T) {
		const result = await this.#bucket.list({
			cursor: options?.cursor,
			limit: options?.limit,
			prefix: options?.prefix,
		});

		return {
			files: result.objects.map((object) => {
				const metadata =
					object.customMetadata as unknown as R2FileStorage.CustomMetadata;

				if (options?.includeMetadata === true) {
					return {
						key: object.key,
						lastModified: object.uploaded.getTime(),
						name: metadata?.name ?? object.key,
						size: object.size,
						type: object.httpMetadata?.contentType ?? metadata?.type,
					} satisfies FileMetadata;
				}

				return { key: object.key } satisfies FileKey;
			}) as ListResult<T>["files"],
			cursor: result.truncated ? result.cursor : undefined,
		};
	}

	async put(key: string, file: File) {
		const customMetadata = {
			name: file.name,
			type: file.type,
		} satisfies R2FileStorage.CustomMetadata;

		const body = await file.arrayBuffer();

		await this.#bucket.put(key, body, {
			httpMetadata: { contentType: file.type },
			customMetadata,
		});

		return file;
	}

	async remove(key: string) {
		await this.#bucket.delete(key);
	}

	async set(key: string, file: File) {
		await this.put(key, file);
	}
}
