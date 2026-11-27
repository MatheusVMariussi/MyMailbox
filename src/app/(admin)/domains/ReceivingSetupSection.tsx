"use client";

import { useEffect, useState, type ReactNode } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { requestJson } from "./api";
import ProviderCard from "./ProviderCard";
import type { Domain, ReceivingProvider } from "./types";

type Props = {
	domain: Domain;
	onChange?: (provider: ReceivingProvider) => void;
	busy?: boolean;
	message?: string | null;
	/** Cloudflare routing status and setup, rendered by the parent that owns the DNS view. */
	cloudflareConfig: ReactNode;
	cloudflareOk: boolean;
};

/** Cloudflare Email Routing is the only receiving service: on receives through it, off makes the domain send-only. */
export default function ReceivingSetupSection({ domain, onChange, busy, message, cloudflareConfig, cloudflareOk }: Props) {
	const { t } = useLanguage();
	const [present, setPresent] = useState<boolean | null>(null);
	const [reload, setReload] = useState(0);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<{ cloudflare?: boolean }>(`/api/domains/${domain.id}/receiving`, "GET")
			.then((data) => { if (active) setPresent(data.cloudflare ?? null); })
			.catch(() => { if (active) setPresent(null); });
		return () => { active = false; };
	}, [domain.id, domain.receivingProvider, reload]);

	const title = t("domains.opt.cfRouting");
	const selected = domain.receivingProvider === "cloudflare";

	async function cleanUp() {
		if (!await confirmDestructive(t("domains.removeReceivingConfirm", { title, host: domain.hostname }))) return;
		setRemoving(true);
		setError("");
		try {
			await requestJson(`/api/domains/${domain.id}/receiving`, "DELETE", { target: "cloudflare" });
			setReload((value) => value + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domains.removeConfigFailed"));
		} finally { setRemoving(false); }
	}

	return (
		<section className="mt-6">
			<h2 className="text-base font-semibold text-neutral-900">{t("domains.setupReceiving")}</h2>
			<p className="mt-0.5 text-sm text-neutral-500">
				{t("domains.setupReceivingDescription")}
			</p>
			<ul className="mt-3 space-y-2">
				<ProviderCard
					title={title}
					description={t("domains.opt.cfRoutingDesc")}
					ok={selected ? cloudflareOk : null}
					selected={selected}
					disabled={busy}
					onToggle={(on) => onChange?.(on ? "cloudflare" : "none")}
					cleanup={{ present: !!present, busy: removing, disabled: removing, onClick: () => void cleanUp() }}
				>
					{cloudflareConfig}
				</ProviderCard>
			</ul>
			{domain.receivingProvider === "none" && <p className="mt-2 text-xs text-neutral-500">{t("domains.noReceiving")}</p>}
			{message && <p role="alert" className="mt-2 text-xs text-red-600">{message}</p>}
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</section>
	);
}
