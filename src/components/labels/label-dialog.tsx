"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NavLabel } from "@/components/dashboard-nav-types";
import { dispatchMessagesChanged } from "@/lib/messages/change-events";
import { labelColorKeys } from "@/lib/labels/color-keys";
import { DEFAULT_LABEL_COLOR, LABEL_COLOR_OPTIONS } from "@/lib/labels/colors";
import { createLabelRequest, deleteLabelRequest, updateLabelRequest } from "@/lib/labels/client";
import { LABEL_NAME_MAX } from "@/lib/labels/label-utils";
import type { LabelColor } from "@/lib/labels/types";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mailboxId: string;
	/** Edit this label; without it the dialog creates one. */
	label?: NavLabel | null;
};

function isPaletteColor(value: string | undefined): value is LabelColor {
	return LABEL_COLOR_OPTIONS.some((option) => option.value === value);
}

/** Create, or rename, recolor and delete, one label of a mailbox. */
export function LabelDialog({ open, onOpenChange, mailboxId, label }: Props) {
	const { t } = useLanguage();
	const router = useRouter();
	const pathname = usePathname();
	const [name, setName] = useState(label?.name ?? "");
	const [color, setColor] = useState<LabelColor>(isPaletteColor(label?.color) ? label.color : DEFAULT_LABEL_COLOR);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const editing = !!label;

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!name.trim()) return;
		setPending(true);
		setError(null);
		try {
			if (label) await updateLabelRequest(label.id, { name, color }, t("labels.saveFailed"));
			else await createLabelRequest({ mailboxId, name, color }, t("labels.createFailed"));
			// Chips on list rows and in the reader show the new name and color.
			if (label) dispatchMessagesChanged();
			onOpenChange(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t(label ? "labels.saveFailed" : "labels.createFailed"));
		} finally {
			setPending(false);
		}
	}

	async function remove() {
		if (!label) return;
		if (!await confirmDestructive(t("labels.deleteConfirm", { name: label.name }))) return;
		setPending(true);
		setError(null);
		try {
			await deleteLabelRequest(label.id, t("labels.deleteFailed"));
			dispatchMessagesChanged();
			onOpenChange(false);
			if (pathname === `/labels/${label.id}` || pathname.startsWith(`/labels/${label.id}/`)) router.push("/inbox");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("labels.deleteFailed"));
		} finally {
			setPending(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
			<DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t(editing ? "labels.edit" : "labels.create")}</DialogTitle>
					<DialogDescription>{t(editing ? "labels.editDescription" : "labels.description")}</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="labelName">{t("labels.name")}</Label>
						<Input
							id="labelName"
							value={name}
							maxLength={LABEL_NAME_MAX}
							onChange={(event) => setName(event.target.value)}
							placeholder={t("labels.example")}
							autoFocus
						/>
					</div>
					<div className="space-y-2">
						<Label>{t("navigation.color")}</Label>
						<div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("labels.color")}>
							{LABEL_COLOR_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									role="radio"
									aria-checked={color === option.value}
									aria-label={t(labelColorKeys[option.value])}
									title={t(labelColorKeys[option.value])}
									onClick={() => setColor(option.value)}
									className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
										color === option.value ? "border-neutral-900 ring-2 ring-neutral-300 ring-offset-2" : "border-transparent"
									}`}
									style={{ backgroundColor: option.value }}
								/>
							))}
						</div>
					</div>
					{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Button type="submit" disabled={pending || !name.trim()}>
							{pending ? t(editing ? "labels.saving" : "navigation.creating") : t(editing ? "labels.save" : "labels.create")}
						</Button>
						{editing && (
							<Button type="button" variant="ghost" className="text-red-600 hover:text-red-700" disabled={pending} onClick={() => void remove()}>
								{t("labels.delete")}
							</Button>
						)}
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
