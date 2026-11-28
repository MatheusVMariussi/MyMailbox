"use client";

import { RefreshCw } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** The header refresh button; the list owns the refresh (useMessageListRefresh) so pull-to-refresh shares its state. */
export function MessageListRefreshButton({ disabled = false, refreshing, onRefresh }: {
	disabled?: boolean;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const { t } = useLanguage();
	const label = refreshing ? t("list.refreshing") : t("list.refresh");
	return (
		<>
			<Tooltip label={label}>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled || refreshing}
					aria-label={label}
					aria-busy={refreshing}
					onClick={onRefresh}
				>
					<RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
				</Button>
			</Tooltip>
			<span role="status" aria-live="polite" className="sr-only">
				{refreshing ? t("list.refreshing") : ""}
			</span>
		</>
	);
}
