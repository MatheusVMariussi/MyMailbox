"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { HelpCircle } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { SEARCH_HELP_ENTRIES, SEARCH_HELP_SYNTAX } from "./search-help-utils";
import type { SearchHelpMenuProps } from "./types";

const contentClass = "z-[130] max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-surface-1 p-2 text-sm shadow-[0_24px_64px_-24px_rgb(0_0_0/0.6)]";
const rowClass = "grid grid-cols-[minmax(0,8.5rem)_1fr] items-baseline gap-3 rounded-lg px-3 py-1.5 max-sm:grid-cols-[minmax(0,7rem)_1fr]";
const codeClass = "truncate font-mono text-xs text-accent";

/** The "?" in the search box: the operators, each appended to the query when picked, and how terms combine. */
export function SearchHelpMenu({ onInsert, onDismiss }: SearchHelpMenuProps) {
	const { t } = useLanguage();
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger
				type="button"
				aria-label={t("search.help.open")}
				title={t("search.help.open")}
				data-search-help-trigger=""
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
			>
				<HelpCircle className="h-4 w-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={10}
					collisionPadding={8}
					className={contentClass}
					data-search-help=""
					data-header-search-popover=""
					onCloseAutoFocus={(event) => {
						// Back to the field, not the trigger: you were typing a query.
						event.preventDefault();
						onDismiss?.();
					}}
				>
					<DropdownMenu.Label className="px-3 pb-1 pt-1 font-mono text-[11px] text-ink-muted"><span aria-hidden="true">{"// "}</span>{t("search.help.title").toLocaleLowerCase()}</DropdownMenu.Label>
					{SEARCH_HELP_ENTRIES.map((entry) => (
						<DropdownMenu.Item
							key={entry.example}
							onSelect={() => onInsert(entry.insert)}
							className={`${rowClass} cursor-pointer text-ink-soft outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink`}
						>
							<code className={codeClass}>{entry.example}</code>
							<span>{t(entry.descriptionKey)}</span>
						</DropdownMenu.Item>
					))}
					<DropdownMenu.Separator className="mx-3 my-1.5 h-px bg-line" />
					{SEARCH_HELP_SYNTAX.map((entry) => (
						<div key={entry.example} className={`${rowClass} text-ink-muted`}>
							<code className={codeClass}>{entry.example}</code>
							<span>{t(entry.descriptionKey)}</span>
						</div>
					))}
					<p className="px-3 pb-1 pt-2 text-xs text-ink-muted">{t("search.help.enter")}</p>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
