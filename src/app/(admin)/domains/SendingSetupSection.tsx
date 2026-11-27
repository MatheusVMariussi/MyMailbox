"use client";

import { useEffect, useState, type ReactNode } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { requestJson } from "./api";
import ProviderCard from "./ProviderCard";
import type { Domain, SendingProvider } from "./types";

type Props = {
	domain: Domain;
	onChange?: (provider: SendingProvider) => void;
	busy?: boolean;
	message?: string | null;
	/** Config UI for Cloudflare sending, rendered by the parent which owns the DNS audit. */
	cloudflareConfig: ReactNode;
	/** Whether Cloudflare sending is fully set up (subdomain enabled, DKIM present). */
	cloudflareOk: boolean;
};

/** Cloudflare Email Sending is the only sending service: on sends through it, off makes the domain receive-only. */
export default function SendingSetupSection({ domain, onChange, busy, message, cloudflareConfig, cloudflareOk }: Props) {
	const { t } = useLanguage();
	const [present, setPresent] = useState<boolean | null>(null);
	const [reload, setReload] = useState(0);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<{ cloudflare?: boolean }>(`/api/domains/${domain.id}/sending`, "GET")
			.then((data) => { if (active) setPresent(data.cloudflare ?? null); })
			.catch(() => { if (active) setPresent(null); });
		return () => { active = false; };
	}, [domain.id, domain.sendingProvider, reload]);

	const title = t("domains.opt.cfEmail");
	const selected = domain.sendingProvider === "cloudflare";

	async function cleanUp() {
		if (!await confirmDestructive(t("domains.removeSendingConfirm", { title, host: domain.hostname }))) return;
		setRemoving(true);
		setError("");
		try {
			await requestJson(`/api/domains/${domain.id}/sending`, "DELETE", { target: "cloudflare" });
			setReload((value) => value + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domains.removeConfigFailed"));
		} finally { setRemoving(false); }
	}

	return (
		<section className="mt-6">
			<h2 className="text-base font-semibold text-neutral-900">{t("domains.setupSending")}</h2>
			<p className="mt-0.5 text-sm text-neutral-500">
				{selected ? t("domains.sendingChoose") : t("domains.sendingNone")}
			</p>
			<ul className="mt-3 space-y-2">
				<ProviderCard
					title={title}
					description={t("domains.opt.cfSendDesc")}
					ok={selected || present ? cloudflareOk : null}
					selected={selected}
					disabled={busy}
					onToggle={(on) => onChange?.(on ? "cloudflare" : "none")}
					cleanup={{ present: !!present, busy: removing, disabled: removing, onClick: () => void cleanUp() }}
				>
					{cloudflareConfig}
				</ProviderCard>
			</ul>
			{message && <p role="alert" className="mt-2 text-xs text-red-600">{message}</p>}
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</section>
	);
}
