"use client";

import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { ResizeHandleProps } from "./resize-handle-types";

/** How far one arrow key press moves the boundary. */
const KEYBOARD_STEP = 24;

export function ResizeHandle({ label, onResizeStart, onResize, onResizeEnd }: ResizeHandleProps) {
	const startX = useRef<number | null>(null);

	function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		startX.current = event.clientX;
		event.currentTarget.setPointerCapture(event.pointerId);
		onResizeStart?.();
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
		if (startX.current === null) return;
		onResize(event.clientX - startX.current);
	}

	function handlePointerEnd() {
		if (startX.current === null) return;
		startX.current = null;
		onResizeEnd?.();
	}

	// Arrow keys move the boundary in steps, so the columns can be resized without a pointer.
	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		onResizeStart?.();
		onResize(event.key === "ArrowLeft" ? -KEYBOARD_STEP : KEYBOARD_STEP);
		onResizeEnd?.();
	}

	return (
		<div
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			tabIndex={0}
			className="group/resize absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none outline-none"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
			onKeyDown={handleKeyDown}
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent opacity-0 transition-opacity duration-150 ease-out-soft group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-active/resize:opacity-100 motion-reduce:transition-none"
			/>
		</div>
	);
}
