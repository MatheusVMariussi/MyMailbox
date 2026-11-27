"use client";

import { useId } from "react";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { useTwoColumnReading } from "@/components/messages/use-two-column-reading";
import { useAutoAdvanceEnabled } from "@/components/messages/use-auto-advance";

export function InboxReadingLayoutSettings() {
	const { t } = useLanguage();
	const titleId = useId();
	const [twoColumnReading, setTwoColumnReading] = useTwoColumnReading();
	const [autoAdvance, setAutoAdvance] = useAutoAdvanceEnabled();

	return (
		<div className="space-y-3">
			{/* Reading pane: right (three panes, the default) or off (full-width list, full-width reader). */}
			<div className="flex flex-wrap items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="min-w-0 flex-1 basis-60">
					<span id={titleId} className="block text-sm font-medium text-neutral-900">{t("settings.reading.title")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.reading.description")}
					</span>
				</span>
				<span role="radiogroup" aria-labelledby={titleId} className="inline-flex shrink-0 rounded-lg border border-line bg-surface-1 p-0.5">
					{([true, false] as const).map((right) => (
						<button
							key={String(right)}
							type="button"
							role="radio"
							aria-checked={twoColumnReading === right}
							onClick={() => setTwoColumnReading(right)}
							className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${twoColumnReading === right ? "bg-accent-soft text-ink" : "text-ink-muted hover:text-ink"}`}
						>
							{right ? t("settings.reading.right") : t("settings.reading.off")}
						</button>
					))}
				</span>
			</div>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.reading.autoAdvanceTitle")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.reading.autoAdvanceDescription")}
					</span>
				</span>
				<Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} aria-label={t("settings.reading.autoAdvanceTitle")} />
			</label>
		</div>
	);
}
