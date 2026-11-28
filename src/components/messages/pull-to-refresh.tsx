"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { RefreshCw } from "@/components/icons";

// Finger travel before the pull is claimed; below the browsers' scroll slop, so the touchmove is still cancelable.
const START_SLOP = 6;
// The indicator's offset approaches MAX as the finger travels (rubber band).
const MAX_OFFSET = 110;
const RESISTANCE = 160;
const TRIGGER_OFFSET = 64;
const HOLD_OFFSET = 56;
const INDICATOR_SIZE = 40;
// A refresh that answers at once still shows the spinner long enough to read as done.
const MIN_SPIN_MS = 450;
const HAPTIC_MS = 8;
const SETTLE = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease-out";

type Props = {
	/** The list's scroll container; a pull only starts when it is scrolled to the top. */
	scrollRef: RefObject<HTMLElement | null>;
	onRefresh: () => Promise<void>;
	/** A refresh is already running (from the header button or an earlier pull). */
	refreshing: boolean;
	disabled?: boolean;
};

function offsetFor(travel: number): number {
	return MAX_OFFSET * (1 - Math.exp(-travel / RESISTANCE));
}

/**
 * Touch pull-to-refresh for the message list (phones and the installed PWA, where
 * the browser offers none). Render it as the scroll container's first child. The
 * drag moves the indicator straight through the DOM so the list does not re-render
 * on every touchmove.
 */
export function PullToRefresh({ scrollRef, onRefresh, refreshing, disabled = false }: Props) {
	const indicatorRef = useRef<HTMLDivElement>(null);
	const iconRef = useRef<HTMLSpanElement>(null);
	const busy = useRef(refreshing);
	const refreshHandler = useRef(onRefresh);

	useEffect(() => {
		busy.current = refreshing;
		refreshHandler.current = onRefresh;
	}, [refreshing, onRefresh]);

	useEffect(() => {
		const scroller = scrollRef.current;
		const indicator = indicatorRef.current;
		const icon = iconRef.current;
		if (!scroller || !indicator || !icon || disabled) return;
		const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		let start: { x: number; y: number } | null = null;
		let pulling = false;
		let armed = false;
		let spinning = false;

		function paint(next: number, settle: boolean) {
			indicator!.style.transition = settle && !reducedMotion ? SETTLE : "none";
			indicator!.style.transform = `translateY(${next - INDICATOR_SIZE}px)`;
			indicator!.style.opacity = String(Math.min(1, next / TRIGGER_OFFSET));
			icon!.style.transform = `rotate(${(next / TRIGGER_OFFSET) * 270}deg)`;
		}

		function setArmed(next: boolean) {
			if (next === armed) return;
			armed = next;
			indicator!.dataset.armed = String(next);
			if (next && "vibrate" in navigator) navigator.vibrate(HAPTIC_MS);
		}

		async function release() {
			if (!armed) {
				paint(0, true);
				return;
			}
			setArmed(false);
			spinning = true;
			indicator!.dataset.spinning = "true";
			paint(HOLD_OFFSET, true);
			const minimum = new Promise((resolve) => window.setTimeout(resolve, MIN_SPIN_MS));
			try {
				await Promise.all([refreshHandler.current(), minimum]);
			} finally {
				spinning = false;
				indicator!.dataset.spinning = "false";
				paint(0, true);
			}
		}

		function onTouchStart(event: TouchEvent) {
			start = null;
			pulling = false;
			if (spinning || busy.current || event.touches.length !== 1 || scroller!.scrollTop > 0) return;
			start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
		}

		function onTouchMove(event: TouchEvent) {
			if (!start) return;
			const touch = event.touches[0];
			const dy = touch.clientY - start.y;
			const dx = touch.clientX - start.x;
			if (!pulling) {
				// Scrolling the list, or a sideways swipe on a row: not ours.
				if (dy < 0 || Math.abs(dx) > dy) {
					if (Math.abs(dx) > START_SLOP || dy < -START_SLOP) start = null;
					return;
				}
				if (dy < START_SLOP) return;
				if (scroller!.scrollTop > 0) {
					start = null;
					return;
				}
				pulling = true;
			}
			// Claim the gesture so the page does not rubber-band under the indicator.
			if (event.cancelable) event.preventDefault();
			const next = offsetFor(Math.max(0, dy - START_SLOP));
			paint(next, false);
			setArmed(next >= TRIGGER_OFFSET);
		}

		function onTouchEnd() {
			if (!pulling) {
				start = null;
				return;
			}
			start = null;
			pulling = false;
			void release();
		}

		function onTouchCancel() {
			if (!pulling) return;
			start = null;
			pulling = false;
			setArmed(false);
			paint(0, true);
		}

		paint(0, false);
		scroller.addEventListener("touchstart", onTouchStart, { passive: true });
		scroller.addEventListener("touchmove", onTouchMove, { passive: false });
		scroller.addEventListener("touchend", onTouchEnd, { passive: true });
		scroller.addEventListener("touchcancel", onTouchCancel, { passive: true });
		return () => {
			scroller.removeEventListener("touchstart", onTouchStart);
			scroller.removeEventListener("touchmove", onTouchMove);
			scroller.removeEventListener("touchend", onTouchEnd);
			scroller.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [scrollRef, disabled]);

	return (
		// Zero height and sticky: takes no room in the list and stays at its top edge while the refresh runs.
		<div aria-hidden="true" className="pointer-events-none sticky top-0 z-20 flex h-0 justify-center">
			<div
				ref={indicatorRef}
				data-armed="false"
				data-spinning="false"
				className="group/ptr flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-ink-muted opacity-0 shadow-md ring-1 ring-line data-[armed=true]:text-accent data-[spinning=true]:text-accent"
				style={{ transform: `translateY(-${INDICATOR_SIZE}px)` }}
			>
				<span ref={iconRef} className="flex">
					<RefreshCw className="h-5 w-5 group-data-[spinning=true]/ptr:animate-spin" />
				</span>
			</div>
		</div>
	);
}
