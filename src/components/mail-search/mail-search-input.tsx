"use client";

import { useEffect, useState } from "react";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { HeaderSearch } from "@/components/header-search";
import { isSearchQuerySettled, appendSearchOperator } from "@/lib/search/input-utils";
import { useMailSearch } from "./mail-search-context";
import { SearchHelpMenu } from "./search-help-menu";
import { useShortcuts } from "@/components/shortcuts";

const SEARCH_DEBOUNCE_MS = 250;

function focusSearchInput() {
	window.requestAnimationFrame(() => {
		const input = document.querySelector<HTMLInputElement>("input[data-mail-search-input]");
		input?.focus();
		input?.setSelectionRange(input.value.length, input.value.length);
	});
}

export function MailSearchInput({ mobileEnd }: { mobileEnd?: boolean }) {
	const { t } = useLanguage();
	const { query, setQuery } = useMailSearch();
	const [input, setInput] = useState(query);
	const { openCommandPalette, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	const showShortcutHints = shortcutsEnabled && !shortcutsPreferenceLoading;

	// Searches run as you type once the query is settled; one with an open quote, bracket or a dangling
	// operator (`from:`, a trailing OR) waits for Enter.
	useEffect(() => {
		if (!isSearchQuerySettled(input)) return;
		const delay = input.trim() ? SEARCH_DEBOUNCE_MS : 0;
		const timer = window.setTimeout(() => setQuery(input.trim() ? input : ""), delay);
		return () => window.clearTimeout(timer);
	}, [input, setQuery]);

	return (
		<HeaderSearch
			value={input}
			onChange={setInput}
			onSubmit={() => setQuery(input.trim() ? input : "")}
			label={t("search.mail")}
			mobileEnd={mobileEnd}
			placeholder={t("search.mail")}
			inputProps={{ "data-mail-search-input": "" }}
			trailing={(
				<>
					{input ? (
						<button
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								setInput("");
								setQuery("");
							}}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
							aria-label={t("search.clear")}
						>
							<X className="h-4 w-4" />
						</button>
					) : showShortcutHints ? (
						// The `/` key focuses the field; the badge says so until you are in it.
						<kbd
							aria-hidden="true"
							title={t("search.mailHint")}
							className="hidden h-5 min-w-5 shrink-0 items-center justify-center rounded border border-line bg-surface-1 px-1 font-mono text-[11px] text-ink-soft md:inline-flex md:group-focus-within/search:hidden"
						>
							/
						</kbd>
					) : null}
					<SearchHelpMenu
						onInsert={(operator) => {
							setInput((current) => appendSearchOperator(current, operator));
							focusSearchInput();
						}}
						onDismiss={focusSearchInput}
					/>
					{showShortcutHints && (
						<button
							type="button"
							onClick={openCommandPalette}
							className="hidden h-6 shrink-0 items-center rounded-md border border-line bg-surface-1 px-1.5 font-mono text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex"
							title={t("search.openPalette")}
							aria-label={t("search.openPalette")}
						>
							⌘K
						</button>
					)}
				</>
			)}
		/>
	);
}
