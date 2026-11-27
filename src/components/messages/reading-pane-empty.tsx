"use client";

import { Fragment } from "react";
import { useLanguage } from "@/components/language-provider";
import { useShortcutsActive } from "@/components/shortcuts/shortcuts-enabled-context";
import { getReadingPanePath, READING_PANE_HINTS } from "./reading-pane-utils";
import type { ReadingPaneEmptyProps } from "./reading-pane-types";

/**
 * What the reading pane shows while no conversation is open: the folder as a terminal prompt with a
 * blinking caret, one line of copy and the keys that get you moving.
 */
export function ReadingPaneEmpty({ folderPath }: ReadingPaneEmptyProps) {
	const { t } = useLanguage();
	const shortcutsActive = useShortcutsActive();
	const path = getReadingPanePath(folderPath);
	return (
		<div className="atmosphere reader-enter flex h-full min-h-0 flex-col items-center justify-center px-8" data-reading-pane-empty="">
			<div className="w-full max-w-[30rem]">
				<p className="flex min-w-0 items-center font-mono text-[15px] leading-6 text-ink-soft" aria-hidden="true">
					<span className="truncate">
						{/* accent-strong keeps the light theme's ~/ above 4.5:1 on the ground behind the atmosphere. */}
						<span className="text-accent-strong dark:text-accent">~/</span>
						{path}
					</span>
					<span className="ml-2 shrink-0 text-ink-muted">$</span>
					<span className="ml-2 inline-block h-4 w-2 shrink-0 bg-accent motion-safe:animate-caret-blink" />
				</p>
				<p className="mt-3 text-sm leading-6 text-ink-muted">{t("readingPane.empty")}</p>
				{shortcutsActive && (
					<p className="mt-6 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-xs text-ink-muted">
						{READING_PANE_HINTS.map((hint) => (
							<span key={hint.labelKey} className="inline-flex items-center gap-1.5">
								{hint.keys.map((key, index) => (
									<Fragment key={key}>
										{index > 0 && <span aria-hidden="true" className="text-ink-muted">/</span>}
										<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-ink-soft">{key}</kbd>
									</Fragment>
								))}
								<span>{t(hint.labelKey)}</span>
							</span>
						))}
					</p>
				)}
			</div>
		</div>
	);
}
