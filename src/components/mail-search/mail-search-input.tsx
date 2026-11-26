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
			placeholder={showShortcutHints ? t("search.mailHint") : t("search.mail")}
			inputProps={{ "data-mail-search-input": "" }}
			trailing={(
				<>
					<SearchHelpMenu
						onInsert={(operator) => {
							setInput((current) => appendSearchOperator(current, operator));
							focusSearchInput();
						}}
					/>
					{input ? (
						<button
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								setInput("");
								setQuery("");
							}}
							className="rounded-full p-1 text-neutral-500 hover:bg-blue-100 hover:text-neutral-800"
							aria-label={t("search.clear")}
						>
							<X className="h-4 w-4" />
						</button>
					) : showShortcutHints ? (
						<button
							type="button"
							onClick={openCommandPalette}
							className="hidden sm:flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-neutral-500 bg-white/70 hover:bg-white border border-neutral-200/80 rounded-md shadow-2xs transition-colors"
							title={t("search.openPalette")}
						>
							<span className="text-[11px] font-mono">⌘K</span>
						</button>
					) : null}
				</>
			)}
		/>
	);
}
