"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUserDate } from "@/lib/time/utils";
import { ChevronsUpDown, Paperclip } from "@/components/icons";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { QuotedEmailToggle } from "@/components/messages/quoted-email-toggle";
import { runSingleMessageAction } from "@/components/message-actions/utils";
import { EmailHtmlRenderer } from "./email-html-renderer";
import { useRemoteContent } from "./use-remote-content";
import { getMessageBodyDisplay, resolveInlineAttachmentUrls } from "@/app/(dashboard)/inbox/[messageId]/utils";

import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { ConversationMessageCardProps, ConversationThreadProps } from "./conversation-thread-types";
import { ThreadMessageActions } from "./thread-message-actions";
import { MessageDetailsPanel } from "./message-details-panel";
import { SenderCheckBadge, SenderCheckNotice } from "./sender-check-notice";
import { MessageOpenStatus } from "./message-open-status";
import { MessageFollowUpStatus } from "@/components/follow-ups/message-follow-up-status";
import {
	getConversationRecipients,
	getConversationSender,
	getConversationSenderEmail,
	partitionThread,
} from "./conversation-thread-utils";
import clsx from "clsx";

/**
 * The other messages in a conversation, ordered oldest to newest and collapsed
 * until opened. Readers can also expand the full visible portion at once.
 */
export function ConversationThread({
	currentMessageId,
	position,
	messages,
	mailboxId,
	currentAccountName,
	ownAddress,
	ownAddresses,
	latestMessagesFirst,
	expandedAll,
	onExpandedAllChange,
	showFullRecipientAddresses = false,
}: ConversationThreadProps) {
	const { t } = useLanguage();
	const slice = partitionThread(messages, currentMessageId, position, latestMessagesFirst);
	const revealTarget = useRef<string | null>(null);

	// A note chip can point at an email hidden inside the collapsed middle.
	useEffect(() => {
		function reveal(event: Event) {
			const id = (event as CustomEvent<string>).detail;
			if (expandedAll) return;
			const hidden = partitionThread(messages, currentMessageId, position, latestMessagesFirst).slice(1, -1);
			if (!hidden.some((message) => message.id === id)) return;
			revealTarget.current = id;
			onExpandedAllChange(true);
		}
		window.addEventListener("mymailbox:reveal-message", reveal);
		return () => window.removeEventListener("mymailbox:reveal-message", reveal);
	}, [expandedAll, messages, currentMessageId, position, latestMessagesFirst, onExpandedAllChange]);

	useEffect(() => {
		if (!expandedAll || revealTarget.current === null) return;
		const id = revealTarget.current;
		revealTarget.current = null;
		document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [expandedAll]);

	if (slice.length === 0) return null;
	const firstMessage = slice[0];
	const lastMessage = slice.at(-1)!;
	const middleMessages = slice.slice(1, -1);
	const collapsed = !expandedAll && middleMessages.length > 0;
	const collapsedLabel = t(position === "before" ? "thread.messagesCollapsed.older" : "thread.messagesCollapsed.newer", { count: middleMessages.length });

	return (
		<section
			aria-label={position === "before" ? t("thread.earlier") : t("thread.later")}
			className={cn(position === (latestMessagesFirst ? "before" : "after") ? "pb-6" : "")}
		>
			<ol className={cn(!collapsed && "divide-y divide-line", latestMessagesFirst ? "border-y" : "border-t", "border-line")}>
				<li className={"border-t-0"}>
					<ConversationMessageCard
						message={firstMessage}
						mailboxId={mailboxId}
						currentAccountName={currentAccountName}
						ownAddress={ownAddress}
						ownAddresses={ownAddresses}
						showFullRecipientAddresses={showFullRecipientAddresses}
					/>
				</li>
				{collapsed ? (
					<li className="my-4 flex h-px items-center justify-center gap-1 border-y border-line py-2 text-center">
						<span className="flex flex-row items-center gap-2 bg-white px-6">
							<span className="font-mono text-xs text-ink-muted">{collapsedLabel}</span>
							<button
								type="button"
								onClick={() => onExpandedAllChange(true)}
								aria-label={t("thread.expand", { label: collapsedLabel })}
								title={t("thread.expand", { label: collapsedLabel })}
								className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<ChevronsUpDown className="h-4 w-4" />
							</button>
						</span>
					</li>
				) : (
					middleMessages.map((message) => (
						<li key={message.id}>
							<ConversationMessageCard
								message={message}
								mailboxId={mailboxId}
								currentAccountName={currentAccountName}
								ownAddress={ownAddress}
								ownAddresses={ownAddresses}
								showFullRecipientAddresses={showFullRecipientAddresses}
							/>
						</li>
					))
				)}
				{lastMessage.id !== firstMessage.id && (
					<li>
						<ConversationMessageCard
							message={lastMessage}
							mailboxId={mailboxId}
							currentAccountName={currentAccountName}
							ownAddress={ownAddress}
							ownAddresses={ownAddresses}
							showFullRecipientAddresses={showFullRecipientAddresses}
						/>
					</li>
				)}
			</ol>
		</section>
	);
}

export function ConversationMessageCard({
	message,
	mailboxId,
	currentAccountName,
	ownAddress,
	ownAddresses,
	defaultExpanded = false,
	showFullRecipientAddresses = false,
}: ConversationMessageCardProps) {
	const { t } = useLanguage();
	const [locallyExpanded, setLocallyExpanded] = useState(defaultExpanded);
	const [locallyRead, setLocallyRead] = useState(message.read);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const expanded = locallyExpanded;
	const sender = getConversationSender(message, currentAccountName);
	const senderEmail = getConversationSenderEmail(message);
	const remote = useRemoteContent(senderEmail, message.status === "spam");
	const recipients = getConversationRecipients(message, showFullRecipientAddresses ? "full" : "address");
	// const href = `${getMessageBackHref(message.direction, message.status)}/${message.id}`;
	const outbound = message.direction === "outbound";
	const attachments = message.attachments.filter((attachment) => attachment.disposition === "attachment");

	const [prevRead, setPrevRead] = useState(message.read);
	if (message.read !== prevRead) {
		setPrevRead(message.read);
		setLocallyRead(message.read);
	}

	// A note chip can point at this email while the card is collapsed.
	useEffect(() => {
		function reveal(event: Event) {
			if ((event as CustomEvent<string>).detail === message.id) setLocallyExpanded(true);
		}
		window.addEventListener("mymailbox:reveal-message", reveal);
		return () => window.removeEventListener("mymailbox:reveal-message", reveal);
	}, [message.id]);

	const body = useMemo(() => {
		if (!expanded) return null;
		const display = getMessageBodyDisplay(message.textBody, message.htmlBody, message.snippet);
		return {
			html: resolveInlineAttachmentUrls(display.htmlBody, message.id, message.attachments),
			text: display.latestContent,
			quotedHtml: resolveInlineAttachmentUrls(display.quotedHtml, message.id, message.attachments),
		};
	}, [expanded, message.id, message.htmlBody, message.snippet, message.textBody, message.attachments]);


	return (
		<article data-message-id={message.id} className={cn("bg-white px-3 transition-colors duration-150 ease-out-soft sm:pl-0 sm:pr-8 motion-reduce:transition-none", !expanded && "hover:bg-surface-2")}>
			<div className="w-full">
				<div className="flex w-full flex-wrap items-start gap-x-3 py-3 sm:pl-[78px]">
					<button
						type="button"
						onClick={() => {
							const shouldExpand = !locallyExpanded;
							setLocallyExpanded(shouldExpand);
							if (!shouldExpand || locallyRead) return;
							setLocallyRead(true);
							void runSingleMessageAction(message.id, "read", { undo: false }).catch(() => setLocallyRead(false));
						}}
						aria-expanded={expanded}
						className="flex min-w-0 flex-1 basis-40 cursor-pointer items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						<ContactAvatar
							mailboxId={mailboxId}
							address={message.fromAddr}
							name={sender}
							hasManagedAvatar={message.fromContactHasAvatar}
							managedAvatarUrl={outbound && mailboxId ? `/api/mailboxes/${mailboxId}/avatar` : undefined}
							className={cn("sm:-ml-12", expanded && "mt-1")}
						/>
						<span className="min-w-0 flex-1">
							<div className="flex flex-col">
								<span className="mt-1 truncate text-sm font-semibold text-ink">
									{sender}
									{expanded && <span className="ml-1.5 hidden font-mono text-[12px] font-normal text-ink-muted sm:inline">&lt;{senderEmail}&gt;</span>}
								</span>
								{expanded && recipients && <span className="text-xs font-normal text-ink-muted">{t("thread.to", { recipients })}</span>}
							</div>
							{!expanded && (
								<span className={clsx(!locallyRead ? "font-semibold text-ink" : "text-ink-muted", "block truncate text-[13px]")}>{message.snippet || t("thread.noPreview")}</span>
							)}
							{!expanded && <SenderCheckBadge message={message} />}
						</span>
					</button>
					<span className={clsx(!locallyRead ? "font-medium text-ink" : "text-ink-muted", "mr-2 mt-2 hidden shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums sm:flex")}>
						{attachments.length > 0 && <Paperclip className="h-3.5 w-3.5" aria-label={t("thread.attachmentCount", { count: attachments.length })} />}
						{formatUserDate(message.createdAt, { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
					</span>
					<ThreadMessageActions
						message={message}
						mailboxId={mailboxId}
						ownAddress={ownAddress}
						ownAddresses={ownAddresses}
						starOnly={!expanded}
						detailsOpen={detailsOpen}
						onToggleDetails={() => setDetailsOpen((open) => !open)}
					/>
					<div className={clsx("flex w-full items-center gap-2 pl-12 font-mono text-[11px] tabular-nums sm:hidden", locallyRead ? "text-ink-muted" : "font-medium text-ink")}>
						{attachments.length > 0 && <Paperclip className="h-3.5 w-3.5" aria-label={t("thread.attachmentCount", { count: attachments.length })} />}
						<span>{formatUserDate(message.createdAt, { month: "short", day: "2-digit", year: "numeric" })}</span>
					</div>
				</div>
				{expanded && (
					<SenderCheckNotice
						message={message}
						detailsOpen={detailsOpen}
						onViewDetails={() => setDetailsOpen((open) => !open)}
						className="mb-3 sm:ml-[78px]"
					/>
				)}
				{detailsOpen && (
					<div className="mb-3 sm:pl-[78px]">
						<MessageDetailsPanel message={message} onClose={() => setDetailsOpen(false)} />
					</div>
				)}
				{expanded && body && (
					<div className="pb-4 pt-2 sm:pl-[78px]">
						{outbound && <MessageOpenStatus messageId={message.id} />}
						{outbound && message.status !== "draft" && <MessageFollowUpStatus messageId={message.id} />}
						{body.html ? (
							<EmailHtmlRenderer html={body.html} autoAllowRemote={remote.autoAllow} onAllowRemote={remote.allowSender} />
						) : (
							<pre className="max-w-[720px] whitespace-pre-wrap break-words font-sans text-[15px] leading-7 text-ink">{body.text}</pre>
						)}
						{body.quotedHtml && <QuotedEmailToggle html={body.quotedHtml} autoAllowRemote={remote.autoAllow} onAllowRemote={remote.allowSender} />}
						{attachments.length > 0 && (
							<ul className="mt-4 flex flex-wrap gap-2">
								{attachments.map((attachment) => (
									<li key={attachment.id}>
										<a
											href={`/api/messages/${message.id}/attachments/${attachment.id}`}
											className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-soft hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
										>
											<Paperclip className="h-3 w-3" />
											<span className="max-w-48 truncate">{attachment.filename}</span>
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</article>
	);
}
