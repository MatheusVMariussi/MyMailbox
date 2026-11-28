"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

const LONG_PRESS_MS = 450;
// Below SwipeableRow's intent distance, so a drag cancels the press before the swipe takes over.
const MOVE_TOLERANCE = 8;
const HAPTIC_MS = 10;

type PressState = { x: number; y: number; id: number; timer: number };

export type LongPressHandlers = {
	onPointerDown: (event: PointerEvent<HTMLElement>) => void;
	onPointerMove: (event: PointerEvent<HTMLElement>) => void;
	onPointerUp: (event: PointerEvent<HTMLElement>) => void;
	onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
	onClickCapture: (event: MouseEvent<HTMLElement>) => void;
	onContextMenu: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Touch-only long press. A press that moves (scroll, swipe) or lifts early is a
 * normal tap; one held in place fires `onLongPress`, and the click the lift
 * would send (opening the message) is swallowed.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean): LongPressHandlers | undefined {
	const press = useRef<PressState | null>(null);
	const fired = useRef(false);
	const callback = useRef(onLongPress);

	useEffect(() => {
		callback.current = onLongPress;
	}, [onLongPress]);

	useEffect(() => () => {
		if (press.current) window.clearTimeout(press.current.timer);
	}, []);

	if (!enabled) return undefined;

	function cancel() {
		if (press.current) window.clearTimeout(press.current.timer);
		press.current = null;
	}

	function fire() {
		cancel();
		fired.current = true;
		if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(HAPTIC_MS);
		callback.current();
	}

	return {
		onPointerDown(event) {
			fired.current = false;
			cancel();
			if (event.pointerType === "mouse" || !event.isPrimary) return;
			press.current = { x: event.clientX, y: event.clientY, id: event.pointerId, timer: window.setTimeout(fire, LONG_PRESS_MS) };
		},
		onPointerMove(event) {
			// After the sheet opened, the finger is still down: keep its drag from starting a swipe.
			if (fired.current) {
				event.stopPropagation();
				return;
			}
			const current = press.current;
			if (!current || current.id !== event.pointerId) return;
			if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > MOVE_TOLERANCE) cancel();
		},
		onPointerUp: cancel,
		onPointerCancel: cancel,
		onClickCapture(event) {
			if (!fired.current) return;
			fired.current = false;
			event.preventDefault();
			event.stopPropagation();
		},
		// Android sends contextmenu for a held touch, sometimes before our timer; take it as the long press.
		onContextMenu(event) {
			if (!press.current && !fired.current) return;
			event.preventDefault();
			if (press.current) fire();
		},
	};
}
