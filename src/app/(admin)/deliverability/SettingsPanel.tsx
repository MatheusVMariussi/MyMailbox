"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Select } from "@/components/ui/select";
import type { DeliverabilitySettings, SuppressionMode } from "./types";
import { saveMode } from "./utils";

type Props = { settings: DeliverabilitySettings; onChange: (settings: DeliverabilitySettings) => void };

export function SettingsPanel({ settings, onChange }: Props) {
	const { t } = useLanguage();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function changeMode(mode: SuppressionMode) {
		setBusy(true);
		setError(null);
		try {
			onChange(await saveMode(mode));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("deliverability.mode.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	return <section className="space-y-5 rounded-2xl bg-white p-5">
		<div className="space-y-2">
			<label htmlFor="suppression-mode" className="block text-sm font-semibold text-neutral-900">{t("deliverability.mode.label")}</label>
			<Select
				id="suppression-mode"
				value={settings.suppressionMode}
				disabled={!settings.canEdit || busy}
				containerClassName="w-full sm:w-96"
				className="h-10 text-sm"
				onChange={(event) => void changeMode(event.target.value as SuppressionMode)}
			>
				<option value="off">{t("deliverability.mode.off")}</option>
				<option value="record">{t("deliverability.mode.record")}</option>
				<option value="enforce">{t("deliverability.mode.enforce")}</option>
			</Select>
			{!settings.canEdit && <p className="text-xs text-neutral-500">{t("deliverability.mode.readOnly")}</p>}
		</div>
		<div className="space-y-2">
			<h2 className="text-sm font-semibold text-neutral-900">{t("deliverability.feeds.title")}</h2>
			<p className="text-xs text-neutral-500">{t("deliverability.feeds.dsn")}</p>
		</div>
		{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
	</section>;
}
