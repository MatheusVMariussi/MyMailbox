"use client";

import { SOURCE_CODE_URL } from "@/lib/source-code";
import { useLanguage } from "./language-provider";

/** Credits line linking to the source code, shown in the sidebar footer. */
export function Credits() {
	const { t } = useLanguage();
	return (
		<p className="px-1 text-[11px] text-neutral-500">
			<a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:underline">
				{t("navigation.credits")}
			</a>
		</p>
	);
}
