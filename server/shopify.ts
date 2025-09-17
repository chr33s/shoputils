import type {
	FileStorage,
	ListOptions,
	ListResult,
} from "@remix-run/file-storage";

import { Exception } from "#shared/utils";
import { createClient, type ClientProps } from "#shared/shopify";
import { verify } from "./utils";

export async function authenticate(request: Request) {
	return {
		admin: verify(request).token,
		customerAccount: verify(request).token,
		carrierService: verifyHmac("header"),
		fulfillmentService: verifyHmac("header"),
		flow: verifyHmac("header"),
		proxy: verifyHmac("url"),
		webhook: verifyHmac("header"),
	};

	function verifyHmac(from: "header" | "url") {
		return (secret: string) => verify(request).hmac({ from, secret });
	}
}

export function client(props: ClientProps) {
	return createClient({
		type: "admin",
		...props,
	});
}

export type Client = ReturnType<typeof client>;

export class ShopifyFileStorage implements FileStorage {
	#client: Client;

	constructor(client: Client) {
		this.#client = client;
	}

	async get(key: string) {
		return this.request(key).then((file) => {
			if (!file?.url) {
				return null;
			}

			const name = file.url.split("/").at(-1)!;
			const type = file.mimeType;

			return fetch(file.url)
				.then((res) => res.blob())
				.then((blob) => new File([blob], name, { type }));
		});
	}

	async has(key: string) {
		return this.request(key).then(Boolean);
	}

	async list(options?: ListOptions) {
		return this.#client({
			query: /* GraphQL */ `
				query ShopifyFileStorageList(
					$after: String
					$first: Int
					$query: String
				) {
					files(after: $after, first: $first, query: $query) {
						nodes {
							... on GenericFile {
								id
								mimeType
								originalFileSize
								updatedAt
								url
							}
							... on MediaImage {
								id
								mimeType
								originalSource {
									fileSize
									url
								}
								updatedAt
							}
						}
						pageInfo {
							endCursor
							hasNextPage
							hasPreviousPage
							startCursor
						}
					}
				}
			`,
			variables: {
				cursor: options?.cursor ?? undefined,
				first: options?.limit ?? 10,
				query: options?.prefix ? `filename:${options.prefix}*` : undefined,
			},
		}).then((res) => {
			const cursor = res.data?.files.pageInfo.hasNextPage
				? res.data?.files.pageInfo.endCursor
				: undefined;

			return res.data?.files.nodes.reduce(
				(result: ListResult<ListOptions>, node: any) => {
					const file = { key: node.originalSource?.url ?? node.url };
					if (options?.includeMetadata) {
						Object.assign(file, {
							lastModified: new Date(node.updatedAt).getTime(),
							name: file.key.split("/").at(-1),
							size: node.originalSource?.fileSize ?? node.originalFileSize,
							type: node.mimeType,
						});
					}
					result.files.push(file);
					return result;
				},
				{
					cursor,
					files: [],
				},
			);
		});
	}

	async put(key: string, file: File) {
		const staged = await this.#client({
			query: /* GraphQL */ `
				mutation ShopifyFileStoragePutStagedUploadsCreate(
					$input: [StagedUploadInput!]!
				) {
					stagedUploadsCreate(input: $input) {
						stagedTargets {
							parameters {
								name
								value
							}
							resourceUrl
							url
						}
						userErrors {
							field
							message
						}
					}
				}
			`,
			variables: {
				input: [
					{
						// fileSize: file.size,
						filename: key,
						httpMethod: "POST",
						mimeType: file.type,
						resource: "IMAGE",
					},
				],
			},
		});
		if (staged.errors) {
			throw new Exception("File upload server error", {
				errors: staged.errors,
				status: 400,
				type: "RESPONSE",
			});
		}

		if (staged.data?.stagedUploadsCreate?.userErrors?.length) {
			throw new Exception("File upload user error", {
				errors: staged.data?.stagedUploadsCreate?.userErrors,
				status: 400,
				type: "RESPONSE",
			});
		}

		const body = new FormData();
		const [target] = staged.data?.stagedUploadsCreate?.stagedTargets ?? [];
		for (const { name, value } of target.parameters) {
			body.set(name, value);
		}
		const blob = await file.arrayBuffer();
		const _file = new File([blob], key, { type: file.type }); // TODO: stream
		body.set("file", _file, key);

		const upload = await fetch(target.url, {
			body,
			method: "POST",
		});
		if (!upload.ok) {
			throw new Exception(upload.statusText, {
				status: upload.status,
				type: "REQUEST",
			});
		}

		const link = await this.#client({
			query: /* GraphQL */ `
				mutation ShopifyFileStoragePutFileCreate($files: [FileCreateInput!]!) {
					fileCreate(files: $files) {
						files {
							fileErrors {
								code
								details
								message
							}
							... on GenericFile {
								id
							}
							... on MediaImage {
								id
							}
						}
						userErrors {
							code
							field
							message
						}
					}
				}
			`,
			variables: {
				files: [
					{
						duplicateResolutionMode: "REPLACE",
						filename: key,
						contentType: "IMAGE",
						originalSource: target.resourceUrl,
					},
				],
			},
		});

		if (link.errors) {
			throw new Exception("File linking server error", {
				errors: link.errors,
				status: 400,
				type: "RESPONSE",
			});
		}

		if (link.data?.fileCreate?.userErrors?.length) {
			throw new Exception("File linking user error", {
				errors: link.data?.fileCreate?.userErrors,
				status: 400,
				type: "RESPONSE",
			});
		}

		if (link.data?.fileCreate?.files?.[0]?.fileErrors.length) {
			throw new Exception("File linking file error", {
				errors: link.data?.fileCreate?.files[0]?.fileErrors,
				status: 400,
				type: "RESPONSE",
			});
		}

		while (true) {
			const { data, errors } = await this.#client({
				query: /* GraphQL */ `
					query ShopifyFileStoragePutFile($id: ID!) {
						node(id: $id) {
							... on GenericFile {
								fileErrors {
									code
									details
									message
								}
								fileStatus
								url
							}
							... on MediaImage {
								fileErrors {
									code
									details
									message
								}
								fileStatus
								originalSource {
									url
								}
							}
						}
					}
				`,
				variables: { id: link.data?.fileCreate?.files?.[0]?.id },
			});
			if (errors) {
				throw new Exception("File processing server error", {
					errors: errors,
					status: 400,
					type: "RESPONSE",
				});
			}

			if (data?.node?.fileErrors.length) {
				throw new Exception("File processing user error", {
					errors: data?.node.fileErrors,
					status: 400,
					type: "RESPONSE",
				});
			}

			switch (data?.node?.fileStatus) {
				case "FAILED":
					throw new Exception("File upload failed", {
						errors: data?.node?.fileErrors,
						status: 400,
						type: "RESPONSE",
					});

				case "READY": {
					const url = data?.node?.originalSource?.url ?? data?.node?.url;
					if (url) {
						return url;
					}
				}
			}

			await new Promise((resolve) => setTimeout(resolve, 750));
		}
	}

	async set(key: string, file: File) {
		await this.put(key, file);
	}

	async remove(key: string) {
		return this.request(key).then(async (file) => {
			if (!file) {
				throw new Exception("File not found", {
					status: 404,
					type: "REQUEST",
				});
			}

			return this.#client({
				query: /* GraphQL */ `
					mutation ShopifyFileStorageRemove($fileIds: [ID!]!) {
						fileDelete(fileIds: $fileIds) {
							deletedFileIds
							userErrors {
								code
								field
								message
							}
						}
					}
				`,
				variables: { fileIds: [file.id] },
			}).then((res) => {
				if (res.errors) {
					throw new Exception("File delete server error", {
						errors: res.errors,
						status: 400,
						type: "RESPONSE",
					});
				}

				if (res.data?.fileDelete?.userErrors?.length) {
					throw new Exception("File delete user error", {
						errors: res.data?.fileDelete?.userErrors,
						status: 400,
						type: "RESPONSE",
					});
				}
			});
		});
	}

	async request(key: string) {
		return this.#client({
			query: /* GraphQL */ `
				query ShopifyFileStorageRequest($query: String!) {
					files(first: 1, query: $query) {
						nodes {
							... on GenericFile {
								id
								mimeType
								url
							}
							... on MediaImage {
								id
								mimeType
								originalSource {
									url
								}
							}
						}
					}
				}
			`,
			variables: { query: `filename:${key}` },
		}).then((res) => {
			const [node] = res.data?.files.nodes ?? [];
			if (node) {
				return {
					id: node.id,
					mimeType: node.mimeType,
					url: node.originalSource?.url ?? node.url,
				};
			}
		});
	}
}

export * from "#shared/shopify";
