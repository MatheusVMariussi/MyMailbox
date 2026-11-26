"use client";

import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Minus, Tag } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { NavLabel } from "@/components/dashboard-nav-types";

export const labelMenuItemClass = "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-neutral-100";
export const labelMenuLabelClass = "mt-1 px-3 pb-1 pt-2 text-sm font-medium text-neutral-500";
const contentClass = "z-[130] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-lg";

type Props = {
	/** `label` toggles labels ("Label as"); `move` adds one and takes the mail out of the inbox ("Move to"). */
	mode: "label" | "move";
	labels: NavLabel[];
	/** For `label`: whether every target carries the label (true), some do, or none (false). */
	labelState?: (labelId: string) => boolean | "indeterminate";
	/** `add` is false when every target already carries the label, so picking it removes it. */
	onPick: (labelId: string, add: boolean) => void;
	trigger: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Items shown above the labels, such as the system folders of "Move to". */
	before?: ReactNode;
	disabled?: boolean;
};

/** The "Label as" and "Move to" dropdowns shared by the list toolbar and the reader. */
export function LabelMenu({ mode, labels, labelState, onPick, trigger, open, onOpenChange, before, disabled }: Props) {
	const { t } = useLanguage();
	return (
		<DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
			<DropdownMenu.Trigger asChild disabled={disabled}>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" sideOffset={4} className={contentClass} data-label-menu={mode}>
					{before}
					{mode === "label" && <DropdownMenu.Label className={labelMenuLabelClass}>{t("labels.labelAs")}</DropdownMenu.Label>}
					{mode === "move" && before && labels.length > 0 && (
						<>
							<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
							<DropdownMenu.Label className={labelMenuLabelClass}>{t("navigation.labels")}</DropdownMenu.Label>
						</>
					)}
					{labels.length === 0 && !before && (
						<DropdownMenu.Item disabled className={labelMenuItemClass}>{t("labels.none")}</DropdownMenu.Item>
					)}
					{labels.map((label) => {
						const state = mode === "label" ? labelState?.(label.id) ?? false : false;
						const content = (
							<>
								<Tag className="h-4 w-4 shrink-0" style={{ color: label.color }} />
								<span className="min-w-0 flex-1 truncate">{label.name}</span>
							</>
						);
						if (mode === "move") {
							return (
								<DropdownMenu.Item key={label.id} className={labelMenuItemClass} onSelect={() => onPick(label.id, true)} data-label-option={label.id}>
									{content}
								</DropdownMenu.Item>
							);
						}
						return (
							<DropdownMenu.CheckboxItem
								key={label.id}
								className={labelMenuItemClass}
								checked={state}
								onSelect={() => onPick(label.id, state !== true)}
								data-label-option={label.id}
							>
								{content}
								<span className="flex h-4 w-4 shrink-0 items-center justify-center text-blue-700">
									<DropdownMenu.ItemIndicator>
										{state === "indeterminate" ? <Minus className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
									</DropdownMenu.ItemIndicator>
								</span>
							</DropdownMenu.CheckboxItem>
						);
					})}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
