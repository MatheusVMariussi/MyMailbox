// Test alias for `cloudflare:workers`. A test publishes the bindings it needs on `globalThis.__testEnv`
// (and deletes it afterwards); `env` forwards every read and write to that object, so `getEnv()` sees
// them exactly as it sees the Worker env and carries no test-only code.
declare global {
	var __testEnv: Record<PropertyKey, unknown> | undefined;
}

const current = (): Record<PropertyKey, unknown> => globalThis.__testEnv ?? {};

export const env = new Proxy({} as Record<PropertyKey, unknown>, {
	get: (_target, property) => current()[property],
	set: (_target, property, value) => {
		globalThis.__testEnv ??= {};
		globalThis.__testEnv[property] = value;
		return true;
	},
	has: (_target, property) => property in current(),
	ownKeys: () => Reflect.ownKeys(current()),
	getOwnPropertyDescriptor: (_target, property) => {
		const descriptor = Reflect.getOwnPropertyDescriptor(current(), property);
		return descriptor ? { ...descriptor, configurable: true } : undefined;
	},
});
