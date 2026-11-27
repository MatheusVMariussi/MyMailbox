"use client";

import Link from "next/link";
import { Menu } from "@/components/icons";
import { useBranding } from "./branding-provider";
import { useSidebar } from "./sidebar-state";
import type { SidebarHeaderProps } from "./sidebar-state-types";
import { Tooltip } from "./ui/tooltip";
import { useLanguage } from "./language-provider";
import { Wordmark } from "./wordmark";
import { hasCustomBranding } from "./wordmark-utils";

const toggleClass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-out-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none";

/**
 * The sidebar's top row: the menu toggle and the `~/mymailbox` wordmark. A custom icon or name set in
 * Admin -> Branding replaces the wordmark with that icon and name.
 */
export function SidebarHeader({ href, label }: SidebarHeaderProps) {
	const { t } = useLanguage();
	const branding = useBranding();
	const { minimal, toggle } = useSidebar();
	const custom = hasCustomBranding(branding);
	const toggleButton = <button type="button" onClick={toggle} className={toggleClass} aria-label={minimal ? t("navigation.expandMenu") : t("navigation.collapseMenu")}>
		{minimal ? <img src={branding.iconUrl} height={28} width={28} alt="" /> : <Menu size={20} />}
	</button>;
	return (
		<div className={`mb-3 flex h-10 items-center ${minimal ? "" : "gap-1.5 px-1"}`}>
			{minimal ? <Tooltip label={t("navigation.expandMenu")} placement="right">{toggleButton}</Tooltip> : toggleButton}
			{!minimal && (
				<Link
					href={href}
					aria-label={label ? `${branding.appName} ${label}` : branding.appName}
					className="flex min-w-0 items-center gap-3 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					{custom ? (
						<>
							<img src={branding.iconUrl} height={28} width={28} alt="" />
							<span className="truncate text-lg font-semibold text-ink">{label ?? branding.appName}</span>
						</>
					) : (
						<Wordmark name={branding.appName} path={label} />
					)}
				</Link>
			)}
		</div>
	);
}
