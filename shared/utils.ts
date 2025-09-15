export type Log = 'error' | 'warn' | 'info' | 'debug';
export function createLogger(log: Log) {
	const logs = {
		debug: 3,
		error: 0,
		info: 2,
		warn: 1,
	} as const;
	let env = "%APP_LOG%" as Log; // compile-time replacement
	if (!(env in logs)) {
		env = 'error';
	}

	return (...args: unknown[]) => {
		if (logs[log] >= logs[env]) {
			return console[log](...args);
		}
	};
}

export type Deserialized = Record<string, any>;
export function deserialize(value: Serialized) {
	const output: Deserialized = {};

	function deserializer(object: any) {
		for (const [key, value] of Object.entries<any>(object)) {
			// TODO JSON.parse(value)

			const keys = key.split(".").reverse();
			const obj = keys.reduce((val, newKey) => {
				const oldKey = newKey.replace(/^\[|\]$/g, "");
				const isArray = oldKey !== newKey;
				if (isArray) {
					const arr: any[] = Array.isArray(val) ? val : [];
					arr[Number.parseInt(oldKey)] = val;
					return arr;
				}
				return { [oldKey]: val };
			}, value as any);

			merge(output, obj);
		}
	}
	deserializer(value);

	return output;
}

export class Exception extends Error {
	errors?: unknown[];
	status = 500;
	type: 'REQUEST' | 'RESPONSE' | 'SERVER' = 'SERVER';

	constructor(
		message: string,
		options?: ErrorOptions & {
			errors?: unknown[];
			status: number;
			type: string;
		},
	) {
		super(message);

		Object.setPrototypeOf(this, new.target.prototype);
		Object.assign(this, {
			errors: [],
			name: this.constructor.name,
			...options,
		});
	}
}

export function formDataObject(formData: FormData) {
	const object: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
	for (const key of formData.keys()) {
		const values = formData.getAll(key);
		object[key] = values.length > 1 ? values : values[0];
	}
	return object;
}

function isObject(value: unknown) {
	const type = Object.prototype.toString.call(value);
	return type === "[object Object]" || type === "[object Array]";
}

export const JSONL = {
	parse(jsonl: string) {
		return jsonl
			.split('\n')
			.filter((string) => string !== '')
			.map<JSONL>((string) => JSON.parse(string));
	},

	stringify(array: object[]): string {
		return array.map((object) => JSON.stringify(object)).join('\n');
	},
}

export type JSON =
	| string
	| number
	| boolean
	| null
	| {[key: string]: JSON}
	| JSON[];

export type JSONL = Record<'__parentId' | 'id', string> & Record<string, JSON | JSON[]>;

export function merge(target: object, source: object) {
	if (source == null) return target;
	if (target == null) return source;

	if (!isObject(target) || !isObject(source)) return source;

	const result = Array.isArray(target) ? [...target] : { ...target };

	const sourceObj = source as Record<string, any>;
	const resultObj = result as Record<string, any>;

	for (const key in sourceObj) {
		if (Object.prototype.hasOwnProperty.call(sourceObj, key)) {
			if (isObject(sourceObj[key]) && isObject(resultObj[key])) {
				resultObj[key] = merge(resultObj[key], sourceObj[key]);
			} else {
				resultObj[key] = sourceObj[key];
			}
		}
	}
	
	return result;
}

export type Serialized = Record<string, string>;
export function serialize(value: Deserialized) {
	const output: Serialized = {};

	function serializer(
		object: any,
		prevKey?: string,
		prevValueIsArray?: boolean,
		currentDepth = 1,
	) {
		for (const [key, value] of Object.entries<any>(object)) {
			let newKey = prevKey ? `${prevKey}.${key}` : key;
			if (prevValueIsArray) {
				newKey = prevKey ? `${prevKey}.[${key}]` : key;
			}

			if (isObject(value) && Object.keys(value).length) {
				serializer(value, newKey, Array.isArray(value), currentDepth + 1);
			} else {
				output[newKey] = value;
			}
		}
	}
	serializer(value);

	return output;
}
