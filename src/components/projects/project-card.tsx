"use client";

import { useState } from "react";
import { AddDomainDialog } from "@/app/(admin)/domains/AddDomainDialog";
import { Globe2, Plus, Trash2, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canManageDomains } from "@/lib/auth/admin";
import { dispatchMessagesChanged } from "@/lib/messages/change-events";
import {
	deleteProjectRequest,
	invalidateProjectsCache,
	restampProjectMessages,
	setProjectAddressesRequest,
	updateProjectRequest,
} from "@/lib/projects/client";
import type { ProjectSummary } from "@/lib/projects/client-types";
import { PROJECT_NAME_MAX, withWholeDomain } from "@/lib/projects/project-utils";
import type { ProjectDomainOption } from "@/lib/projects/types";
import { ProjectColorPicker } from "./project-color-picker";
import { ProjectDot } from "./project-dot";

export type ProjectCardStatus = { tone: "notice" | "error"; text: string } | null;

type Props = {
	project: ProjectSummary;
	domains: ProjectDomainOption[];
	/** Kept by the list: saving remounts the card (its key follows the saved addresses), and the result must stay. */
	status: ProjectCardStatus;
	onStatus: (status: ProjectCardStatus) => void;
};

type AddressRow = { key: number; domainId: string; localPart: string };

let rowKey = 0;
const toRows = (project: ProjectSummary): AddressRow[] => project.addresses.map((address) => ({ key: ++rowKey, domainId: address.domainId, localPart: address.localPart }));

/** One project in settings: rename and recolor it, map its domains and addresses, re-stamp mail, delete it. */
export function ProjectCard({ project, domains, status, onStatus }: Props) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const canAddDomain = !!user && canManageDomains(user);
	const [name, setName] = useState(project.name);
	const [color, setColor] = useState(project.color);
	const [rows, setRows] = useState<AddressRow[]>(() => toRows(project));
	const [pending, setPending] = useState<"save" | "addresses" | "restamp" | "delete" | "domain" | null>(null);
	const identityChanged = name.trim() !== project.name || color !== project.color;

	async function run(kind: NonNullable<typeof pending>, task: () => Promise<string | null>) {
		setPending(kind);
		onStatus(null);
		try {
			const notice = await task();
			onStatus(notice ? { tone: "notice", text: notice } : null);
		} catch (cause) {
			onStatus({ tone: "error", text: cause instanceof Error ? cause.message : t("projects.error") });
		} finally {
			setPending(null);
		}
	}

	const saveIdentity = () => run("save", async () => {
		await updateProjectRequest(project.id, { name, color });
		invalidateProjectsCache();
		return t("projects.saved");
	});

	// Saving the addresses also re-stamps the mail already stored, so lists follow the new mapping at once;
	// "Re-apply" below runs the same re-stamp again on demand.
	const saveAddresses = () => run("addresses", async () => {
		await setProjectAddressesRequest(project.id, rows.filter((row) => row.domainId).map(({ domainId, localPart }) => ({ domainId, localPart })));
		invalidateProjectsCache();
		try {
			const updated = await restampProjectMessages(project.id);
			return t("projects.addressesSavedRestamped", { count: updated });
		} catch {
			return t("projects.addressesSavedRestampFailed");
		}
	});

	// The dialog has already created the domain; map it whole next to the saved addresses (not unsaved edits),
	// then re-stamp so stored mail to it joins the project.
	const mapNewDomain = (domain: { id: string; hostname: string }) => run("domain", async () => {
		const saved = project.addresses.map(({ domainId, localPart }) => ({ domainId, localPart }));
		try {
			await setProjectAddressesRequest(project.id, withWholeDomain(saved, domain.id));
		} catch (cause) {
			invalidateProjectsCache();
			throw new Error(t("projects.domainMapFailed", { host: domain.hostname, error: cause instanceof Error ? cause.message : t("projects.error") }));
		}
		invalidateProjectsCache();
		try {
			const updated = await restampProjectMessages(project.id);
			return t("projects.domainMapped", { host: domain.hostname, count: updated });
		} catch {
			return t("projects.addressesSavedRestampFailed");
		}
	});

	const restamp = () => run("restamp", async () => {
		const updated = await restampProjectMessages(project.id);
		return t("projects.restamped", { count: updated });
	});

	const remove = async () => {
		if (!await confirmDestructive(t("projects.deleteConfirm", { name: project.name }))) return;
		await run("delete", async () => {
			await deleteProjectRequest(project.id);
			invalidateProjectsCache();
			dispatchMessagesChanged();
			return null;
		});
	};

	return (
		<section className="space-y-5 rounded-3xl bg-white p-6" aria-label={project.name} data-project-card={project.id}>
			<div className="flex items-center gap-3">
				<ProjectDot name={project.name} color={project.color} className="h-3 w-3" />
				<h3 className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900">{project.name}</h3>
				<Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-700" disabled={!!pending} onClick={() => void remove()}>
					<Trash2 className="h-4 w-4" />
					{t("projects.delete")}
				</Button>
			</div>

			<div className="space-y-3">
				<div className="space-y-2">
					<Label htmlFor={`project-name-${project.id}`}>{t("projects.name")}</Label>
					<Input id={`project-name-${project.id}`} value={name} maxLength={PROJECT_NAME_MAX} onChange={(event) => setName(event.target.value)} />
				</div>
				<div className="space-y-2">
					<Label>{t("projects.color")}</Label>
					<ProjectColorPicker value={color} onChange={setColor} disabled={!!pending} />
				</div>
				{identityChanged && (
					<Button type="button" size="sm" disabled={!!pending || !name.trim()} onClick={() => void saveIdentity()}>
						{pending === "save" ? t("projects.saving") : t("projects.save")}
					</Button>
				)}
			</div>

			<div className="space-y-3 border-t border-neutral-100 pt-5">
				<div>
					<h4 className="text-sm font-semibold text-neutral-900">{t("projects.addresses")}</h4>
					<p className="mt-1 text-sm text-neutral-500">{t("projects.addressesHint")}</p>
				</div>
				{rows.length === 0 && <p className="text-sm text-neutral-500">{t("projects.noAddresses")}</p>}
				{rows.map((row, index) => (
					<div key={row.key} className="flex flex-wrap items-center gap-2" data-project-address-row="">
						<Input
							aria-label={t("projects.localPart")}
							value={row.localPart}
							placeholder={t("projects.wholeDomain")}
							onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, localPart: event.target.value } : item))}
							className="w-40"
						/>
						<span className="text-sm text-neutral-500">@</span>
						<Select
							aria-label={t("projects.domain")}
							value={row.domainId}
							onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, domainId: event.target.value } : item))}
							placeholder={t("projects.chooseDomain")}
							containerClassName="min-w-48 flex-1"
						>
							{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}
						</Select>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label={t("projects.removeAddress", { index: index + 1 })}
							onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				))}
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={domains.length === 0}
						onClick={() => setRows((current) => [...current, { key: ++rowKey, domainId: domains[0]?.id ?? "", localPart: "" }])}
					>
						<Plus className="h-4 w-4" />
						{t("projects.addAddress")}
					</Button>
					<Button type="button" size="sm" disabled={!!pending} onClick={() => void saveAddresses()}>
						{pending === "addresses" ? t("projects.saving") : t("projects.saveAddresses")}
					</Button>
					<Button type="button" variant="ghost" size="sm" disabled={!!pending} onClick={() => void restamp()} title={t("projects.restampHint")}>
						{pending === "restamp" ? t("projects.restamping") : t("projects.restamp")}
					</Button>
					{canAddDomain && (
						<AddDomainDialog
							trigger={(
								<Button type="button" variant="ghost" size="sm" disabled={!!pending} data-project-add-domain="">
									<Globe2 className="h-4 w-4" />
									{pending === "domain" ? t("projects.addingDomain") : t("projects.addDomain")}
								</Button>
							)}
							description={t("projects.addDomainDescription", { project: project.name })}
							notice={(
								<p className="rounded-xl bg-[#eaf1fb] px-4 py-3 text-sm leading-6 text-neutral-700">
									{t("projects.addDomainToken", { token: "\u0001" }).split("\u0001").flatMap((part, index) => index === 0 ? [part] : [<code key={index} className="no-font-mono text-xs font-semibold text-blue-800">CF_TOKEN</code>, part])}
								</p>
							)}
							onCreated={(domain) => void mapNewDomain(domain)}
						/>
					)}
				</div>
			</div>

			{status?.tone === "notice" && <p role="status" className="text-sm text-neutral-600">{status.text}</p>}
			{status?.tone === "error" && <p role="alert" className="text-sm text-red-600">{status.text}</p>}
		</section>
	);
}
