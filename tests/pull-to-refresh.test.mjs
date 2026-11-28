import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent } from "./helpers/dom-component.mjs";

const { PullToRefresh } = await loadComponent("src/components/messages/pull-to-refresh.tsx", {
	"@/components/icons": `export function RefreshCw() { return null; }`,
});
const { createElement, createRef, act } = await import("react");
const { createRoot } = await import("react-dom/client");

// JSDOM has no Touch constructor; the component only reads clientX/clientY of touches[0].
function touch(target, type, points) {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "touches", { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
	target.dispatchEvent(event);
	return event;
}

async function mount(t, { scrollTop = 0, refreshing = false } = {}) {
	const calls = [];
	const container = document.createElement("div");
	document.body.appendChild(container);
	const scrollRef = createRef();
	const onRefresh = async () => { calls.push("refresh"); };
	const root = createRoot(container);
	t.after(async () => { await act(async () => root.unmount()); container.remove(); });
	await act(async () => {
		root.render(createElement("div", { ref: scrollRef }, createElement(PullToRefresh, { scrollRef, onRefresh, refreshing })));
	});
	scrollRef.current.scrollTop = scrollTop;
	return { scroller: scrollRef.current, calls };
}

async function pull(scroller, to, from = [100, 50]) {
	await act(async () => {
		touch(scroller, "touchstart", [from]);
		touch(scroller, "touchmove", [[from[0], from[1] + 4]]);
		touch(scroller, "touchmove", [to]);
		touch(scroller, "touchend", []);
	});
	// The spinner holds for a minimum time before settling.
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
}

test("a long pull from the top refreshes the list", async (t) => {
	const { scroller, calls } = await mount(t);
	await pull(scroller, [100, 400]);
	assert.deepEqual(calls, ["refresh"]);
});

test("the pulling touchmove is claimed so the page does not bounce", async (t) => {
	const { scroller } = await mount(t);
	let claimed;
	await act(async () => {
		touch(scroller, "touchstart", [[100, 50]]);
		claimed = touch(scroller, "touchmove", [[100, 120]]).defaultPrevented;
		touch(scroller, "touchcancel", []);
	});
	assert.equal(claimed, true);
});

test("a short pull springs back without refreshing", async (t) => {
	const { scroller, calls } = await mount(t);
	await pull(scroller, [100, 90]);
	assert.deepEqual(calls, []);
});

test("a list scrolled down scrolls instead of pulling", async (t) => {
	const { scroller, calls } = await mount(t, { scrollTop: 200 });
	await pull(scroller, [100, 400]);
	assert.deepEqual(calls, []);
});

test("a sideways swipe on a row is left to the row", async (t) => {
	const { scroller, calls } = await mount(t);
	let claimed;
	await act(async () => {
		touch(scroller, "touchstart", [[100, 50]]);
		claimed = touch(scroller, "touchmove", [[180, 60]]).defaultPrevented;
		touch(scroller, "touchmove", [[180, 400]]);
		touch(scroller, "touchend", []);
	});
	assert.equal(claimed, false);
	assert.deepEqual(calls, []);
});

test("no second refresh starts while one is running", async (t) => {
	const { scroller, calls } = await mount(t, { refreshing: true });
	await pull(scroller, [100, 400]);
	assert.deepEqual(calls, []);
});
