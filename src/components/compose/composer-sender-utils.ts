import { resolveProjectForAddress } from "@/lib/projects/resolve-utils";
import type { ProjectHostMapping } from "@/lib/projects/types";

/** One address the composer can send from, with the mailbox that owns it. */
export type ComposerSenderOption = {
	mailboxId: string;
	address: string;
};

export type ComposerSenderPreference = {
	/** A loaded draft's mailbox and From (a reply opens as a draft): it always wins. */
	draftMailboxId?: string | null;
	draftFrom?: string | null;
	/** The list's project filter: new mail starts from that project's first sender option. */
	projectId?: string | null;
	mappings?: readonly ProjectHostMapping[];
	/** The mailbox selected for settings and compose, used when nothing above decides. */
	preferredMailboxId?: string | null;
};

/**
 * The sender a composer starts with. It never changes what the lists show: the composer keeps its own
 * choice instead of writing the global mailbox selection.
 */
export function pickComposerSender(
	options: readonly ComposerSenderOption[],
	preference: ComposerSenderPreference,
): ComposerSenderOption | null {
	if (preference.draftMailboxId) {
		const draftOptions = options.filter((option) => option.mailboxId === preference.draftMailboxId);
		const exact = draftOptions.find((option) => option.address === preference.draftFrom?.toLowerCase());
		if (exact ?? draftOptions[0]) return exact ?? draftOptions[0];
	}
	if (preference.projectId && preference.mappings?.length) {
		// The project's options, the selected mailbox's first when it has one.
		const projectOptions = options.filter((option) => resolveProjectForAddress(preference.mappings!, option.address) === preference.projectId);
		const projectOption = projectOptions.find((option) => option.mailboxId === preference.preferredMailboxId) ?? projectOptions[0];
		if (projectOption) return projectOption;
	}
	if (preference.preferredMailboxId) {
		const preferred = options.find((option) => option.mailboxId === preference.preferredMailboxId);
		if (preferred) return preferred;
	}
	return options[0] ?? null;
}
