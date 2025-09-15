import { data } from "react-router";

import { Exception } from "#shared/utils";

export async function handler<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof Exception) {
			switch (error.type) {
				case "RESPONSE":
				case "REQUEST": {
					return data(
						{
							data: undefined,
							errors: error.errors,
							message: error.message,
						},
						{
							status: error.status,
							statusText: "TEST",
						},
					);
				}

				default: {
					return new Response(error.message, {
						status: error.status,
					});
				}
			}
		}
		throw data(
			{
				data: undefined,
				errors: [{ message: "Unknown Error" }],
			},
			500,
		);
	}
}
