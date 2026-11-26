"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Columns2 } from "@/components/icons";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { useMessageListVisibility } from "./message-list-visibility";

export function MessageReadingHeaderButton() {
	const { t } = useLanguage();
	const router = useRouter();
	const { visible, toggle, singleColumn, backHref, backLabel } = useMessageListVisibility();
	const label = singleColumn
		? t("message.nav.backTo", { folder: backLabel })
		: visible ? t("message.nav.hideList") : t("message.nav.showList");

	function handleClick() {
		if (singleColumn) router.push(backHref);
		else toggle();
	}

	return (
		<Tooltip label={label} className={singleColumn ? "inline-flex" : "hidden lg:inline-flex"}>
			<button
				type="button"
				className={clsx(!singleColumn && !visible && "opacity-60 hover:opacity-100", "hover:bg-neutral-100 hover:text-neutral-900 relative z-10 shrink-0 rounded-full p-2 text-neutral-600 duration-200")}
				onClick={handleClick}
				aria-label={label}
				aria-pressed={singleColumn ? undefined : visible}
			>
				{singleColumn ? <ArrowLeft size={16} /> : <Columns2 size={16} />}
			</button>
		</Tooltip>
	);
}
