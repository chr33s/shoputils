import { useCallback, useState } from "react";

import { createFetcher } from '#shared/fetch';

export function useData<T>({ defaults, values }: { defaults: T; values?: T }) {
	const [data, set] = useState<T>(values ?? defaults);

	const traverse = useCallback(
		(obj: any, keys: string[], action: "get" | "update", newValue?: any) => {
			if (keys.length === 0) {
				return action === "get" ? obj : newValue;
			}

			if (obj == null && action === "get") return;

			const [currentKey, ...remainingKeys] = keys;

			if (action === "get") {
				return traverse(obj[currentKey], remainingKeys, action);
			}

			const newObj = Array.isArray(obj) ? [...obj] : { ...obj };

			if (remainingKeys.length === 0) {
				newObj[currentKey] = newValue;
			} else {
				const nextIsArray =
					remainingKeys.length > 0 && !isNaN(Number(remainingKeys[0]));
				newObj[currentKey] = traverse(
					newObj[currentKey] || (nextIsArray ? [] : {}),
					remainingKeys,
					action,
					newValue,
				);
			}

			return newObj;
		},
		[],
	);

	const get = useCallback(
		(path: string) => traverse(data, parse(path), "get"),
		[data, traverse],
	);

	const update = useCallback(
		(path: string, value: any) => {
			return set((data) => traverse(data, parse(path), "update", value));
		},
		[traverse],
	);

	const add = useCallback(
		(path: string) => {
			const items = get(path);
			if (!Array.isArray(items)) return;

			const template = traverse(defaults, parse(path), "get");
			const item =
				Array.isArray(template) && template.length > 0
					? structuredClone(template[0])
					: null;

			update(path, [...items, item]);
		},
		[defaults, get, update, traverse],
	);

	const remove = useCallback(
		(path: string) => {
			const keys = parse(path);
			const index = Number(keys[keys.length - 1]);
			if (isNaN(index)) return;

			const parentKeys = keys.slice(0, -1);
			const parentArray =
				parentKeys.length > 0 ? traverse(data, parentKeys, "get") : data;
			if (!Array.isArray(parentArray)) return;

			const newArray = parentArray.filter((_, i) => i !== index);
			if (parentKeys.length > 0) {
				set((data) => traverse(data, parentKeys, "update", newArray));
			} else {
				set(newArray as T);
			}
		},
		[data, traverse],
	);

	const reset = useCallback(() => set(defaults), [defaults]);

	return {
		add,
		data,
		get,
		update,
		remove,
		reset,
		set,
	};

	function parse(path: string) {
		return path.split(/[.[\]]/).filter(Boolean);
	}
}

export function useFetch(props: RequestInit) {
  const fetcher = createFetcher(props);
  return fetcher;
}

