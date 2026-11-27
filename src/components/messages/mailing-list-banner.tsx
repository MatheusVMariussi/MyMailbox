"use client";

import { Mail, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { MessageUnsubscribeButton } from "./unsubscribe-button";

/**
 * Gmail-style notice pinned to the top of an open message that carries a
 * List-Unsubscribe header. Closing it hides the banner for that message; the
 * small inline unsubscribe button next to the sender takes its place.
 */
export function MailingListBanner({ messageId, onDismiss }: { messageId: string; onDismiss: () => void }) {
	const { t } = useLanguage();
	return (
		<div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink-soft sm:mx-0 sm:ml-[78px]">
			<Mail className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
			<span className="min-w-0 flex-1">{t("message.mailingListNotice")}</span>
			<MessageUnsubscribeButton messageId={messageId} variant="row" />
			<button
				type="button"
				aria-label={t("navigation.close")}
				onClick={onDismiss}
				className="shrink-0 rounded-full p-1 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
			>
				<X className="h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	);
}
