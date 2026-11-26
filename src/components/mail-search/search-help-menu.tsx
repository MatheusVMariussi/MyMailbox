"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { HelpCircle } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { SEARCH_HELP_ENTRIES, SEARCH_HELP_SYNTAX } from "./search-help-utils";
import type { SearchHelpMenuProps } from "./types";

const contentClass = "z-[130] max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 text-sm shadow-lg";
const rowClass = "grid grid-cols-[9rem_1fr] items-baseline gap-3 rounded-lg px-3 py-1.5";
const codeClass = "truncate font-mono text-xs text-blue-700";

/** The "?" in the search box: the operators, each appended to the query when picked, and how terms combine. */
export function SearchHelpMenu({ onInsert }: SearchHelpMenuProps) {
	const { t } = useLanguage();
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger
				type="button"
				aria-label={t("search.help.open")}
				title={t("search.help.open")}
				data-search-help-trigger=""
				className="hidden shrink-0 rounded-full p-1 text-neutral-500 hover:bg-blue-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-blue-600 data-[state=open]:bg-blue-100 data-[state=open]:text-neutral-800 md:flex"
			>
				<HelpCircle className="h-4 w-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" sideOffset={10} className={contentClass} data-search-help="" onCloseAutoFocus={(event) => event.preventDefault()}>
					<DropdownMenu.Label className="px-3 pb-1 pt-1 text-sm font-medium text-neutral-500">{t("search.help.title")}</DropdownMenu.Label>
					{SEARCH_HELP_ENTRIES.map((entry) => (
						<DropdownMenu.Item
							key={entry.example}
							onSelect={() => onInsert(entry.insert)}
							className={`${rowClass} cursor-pointer text-neutral-700 outline-none data-[highlighted]:bg-neutral-100`}
						>
							<code className={codeClass}>{entry.example}</code>
							<span>{t(entry.descriptionKey)}</span>
						</DropdownMenu.Item>
					))}
					<DropdownMenu.Separator className="mx-3 my-1.5 h-px bg-neutral-100" />
					{SEARCH_HELP_SYNTAX.map((entry) => (
						<div key={entry.example} className={`${rowClass} text-neutral-600`}>
							<code className={codeClass}>{entry.example}</code>
							<span>{t(entry.descriptionKey)}</span>
						</div>
					))}
					<p className="px-3 pb-1 pt-2 text-xs text-neutral-500">{t("search.help.enter")}</p>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
