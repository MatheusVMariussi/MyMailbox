import { loadApp } from "./real-db.mjs";

/**
 * The Worker entrypoint (`worker.ts`) with the vinext request handler and the realtime Durable Object
 * stubbed, so tests drive its `email()` handler exactly as Cloudflare Email Routing does.
 */
export async function loadWorker(name) {
	const { app, newDatabase } = await loadApp(name, `
		export { default as worker } from "./worker.ts";
		export { processInboundMessage } from "./src/lib/email/inbound.ts";
	`, {
		mocks: {
			"vinext/server/fetch-handler": "export default { fetch() { throw new Error('not used in tests'); } };",
			"./src/lib/realtime/hub": "export class RealtimeHub {}",
		},
	});
	return { worker: app.worker, processInboundMessage: app.processInboundMessage, newDatabase };
}

/** A stand-in for Cloudflare's ForwardableEmailMessage that records rejects and forwards. */
export function emailMessage({ from, to, raw, headers = {}, forwardFails = false }) {
	const bytes = new TextEncoder().encode(raw);
	const message = {
		from,
		to,
		rawSize: bytes.byteLength,
		headers: new Headers(headers),
		raw: new Response(bytes).body,
		rejected: [],
		forwarded: [],
		setReject(reason) { message.rejected.push(reason); },
		async forward(destination) {
			if (forwardFails) throw new Error("forward failed");
			message.forwarded.push(destination);
		},
		async reply() {},
	};
	return message;
}

/** In-memory R2 and queue bindings that keep what the handler stored and enqueued. */
export function mailBindings() {
	const objects = new Map();
	const queued = [];
	return {
		objects,
		queued,
		BUCKET: {
			put: async (key, value) => { objects.set(key, value instanceof ArrayBuffer ? value : new Uint8Array(value).buffer); },
			get: async (key) => objects.has(key) ? { size: objects.get(key).byteLength, arrayBuffer: async () => objects.get(key) } : null,
			head: async (key) => objects.has(key) ? {} : null,
			delete: async (keys) => { for (const key of [keys].flat()) objects.delete(key); },
		},
		INBOUND_QUEUE: { send: async (payload) => { queued.push(payload); } },
	};
}
