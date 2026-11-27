"use client";

import { useEffect, useState } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepUpDialog } from "@/components/settings/step-up-dialog";
import { useSecurityStatus } from "@/components/settings/security-status-store";
import { authFetch } from "@/lib/auth/client";
import { postJson } from "./api";
import { StatusRow } from "./status-row";

type Props = {
	configured: boolean | null;
	/** Called after the key was saved (true) or removed (false). */
	onChanged: (configured: boolean) => void;
	onError: (message: string) => void;
};

type KeySource = "settings" | "environment" | null;
type PendingChange = { kind: "save"; apiKey: string } | { kind: "remove" };

/**
 * The shared Resend API key, used by both the sending and receiving setup. A key set as the
 * RESEND_API_KEY Worker secret wins and is shown read-only. Saving or removing the stored key
 * needs a fresh confirmation (step-up), as other security changes do.
 */
export default function ResendKeyRow({ configured, onChanged, onError }: Props) {
	const { t } = useLanguage();
	const { status: securityStatus } = useSecurityStatus();
	const [apiKey, setApiKey] = useState("");
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [source, setSource] = useState<KeySource>(null);
	const [pending, setPending] = useState<PendingChange | null>(null);
	const fromEnvironment = source === "environment";
	const showForm = !fromEnvironment && (configured === false || editing);

	useEffect(() => {
		let active = true;
		// Only the primary admin may read this; anyone else keeps the generic row.
		void authFetch("/api/admin/resend-key", { redirectOnUnauthorized: false, cache: "no-store" })
			.then(async (response) => (response.ok ? ((await response.json()) as { source?: KeySource }) : null))
			.then((data) => { if (active && data) setSource(data.source ?? null); })
			.catch(() => {});
		return () => { active = false; };
	}, [configured]);

	async function run(action: () => Promise<void>) {
		setBusy(true);
		onError("");
		try { await action(); } catch (error) { onError(error instanceof Error ? error.message : t("domains.requestFailed")); } finally { setBusy(false); }
	}

	const apply = (change: PendingChange, stepUpToken: string) => run(async () => {
		if (change.kind === "save") {
			await postJson("/api/admin/resend-key", "PUT", { apiKey: change.apiKey, stepUpToken });
			setApiKey("");
			setEditing(false);
			onChanged(true);
			return;
		}
		await postJson("/api/admin/resend-key", "DELETE", { stepUpToken });
		onChanged(false);
	});
	const requestRemove = async () => {
		if (!await confirmDestructive(t("resend.removeConfirm"))) return;
		setPending({ kind: "remove" });
	};

	const status = fromEnvironment ? t("resend.keyFromEnv") : configured ? t("resend.keySaved") : t("domains.checking");
	return (
		<>
			<StatusRow
				ok={!!configured && !editing}
				title={t("resend.key")}
				hint={t("resend.keyHint")}
				action={configured && !editing && !fromEnvironment ? (
					<>
						<Button size="sm" variant="outline" className="bg-white" disabled={busy} onClick={() => setEditing(true)}>{t("resend.replace")}</Button>
						<Button size="sm" variant="outline" className="bg-white" disabled={busy} onClick={() => void requestRemove()}>{t("resend.remove")}</Button>
					</>
				) : undefined}
			>
				{showForm ? (
					<form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (apiKey.trim()) setPending({ kind: "save", apiKey }); }}>
						<Input type="password" autoComplete="off" aria-label={t("resend.key")} placeholder="re_..." value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="max-w-xs bg-white" />
						<Button type="submit" size="sm" disabled={!apiKey.trim() || busy}>{busy ? t("domains.checking") : t("resend.saveKey")}</Button>
						{editing && <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => { setEditing(false); setApiKey(""); }}>{t("common.cancel")}</Button>}
					</form>
				) : status}
			</StatusRow>
			{showForm && <li className="list-none px-1 text-xs text-neutral-500">{t("resend.keyInstructions")}</li>}
			<StepUpDialog
				open={!!pending}
				hasPassword={securityStatus?.passwordSet ?? true}
				hasPasskey={(securityStatus?.passkeys.length ?? 0) > 0}
				requireSecondFactor={securityStatus?.requireSecondFactor ?? false}
				totpEnabled={securityStatus?.totpEnabled ?? false}
				action="provider.resend_key"
				onOpenChange={(open) => { if (!open) setPending(null); }}
				onAuthorized={(token) => {
					const change = pending;
					setPending(null);
					if (change) void apply(change, token);
				}}
			/>
		</>
	);
}
