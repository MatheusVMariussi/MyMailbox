"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Columns2 } from "@/components/icons";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { useIsDesktop } from "@/components/sidebar-mobile-utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useMessageListVisibility } from "./message-list-visibility";

/**
 * The reader's first toolbar button. Beside the list it folds the list away (or brings it back); when the
 * reader covers the page (phones, or the reading pane turned off) it is the way back to the list.
 */
export function MessageReadingHeaderButton() {
	const { t } = useLanguage();
	const router = useRouter();
	const splitViewport = useIsDesktop();
	const { visible, toggle, singleColumn, backHref, backLabel } = useMessageListVisibility();
	const back = singleColumn || !splitViewport;
	const label = back
		? t("message.nav.backTo", { folder: backLabel })
		: visible ? t("message.nav.hideList") : t("message.nav.showList");

	function handleClick() {
		if (back) router.push(backHref);
		else toggle();
	}

	return (
		<Tooltip label={label} className="inline-flex">
			<button
				type="button"
				className={clsx(!back && !visible && "opacity-60 hover:opacity-100", "relative z-10 shrink-0 rounded-full p-2 text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent")}
				onClick={handleClick}
				aria-label={label}
				aria-pressed={back ? undefined : visible}
			>
				{back ? <ArrowLeft size={16} /> : <Columns2 size={16} />}
			</button>
		</Tooltip>
	);
}
