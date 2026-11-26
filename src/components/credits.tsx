"use client";

import { SOURCE_CODE_URL } from "@/lib/source-code";
import { useLanguage } from "./language-provider";

/** Credits line linking to the source code, shared by the mail and Drive sidebars. */
export function Credits({ className = "px-1" }: { className?: string }) {
	const { t } = useLanguage();
	return (
		<p className={`${className} text-[11px] text-neutral-500`}>
			<a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:underline">
				{t("navigation.credits")}
			</a>
		</p>
	);
}
