"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { BellRing, Eye, EyeOff, Paperclip, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useListScope } from "@/components/list-scope-provider";
import { useProjects } from "@/components/projects/use-projects";
import { pickComposerSender } from "./composer-sender-utils";
import { authFetch } from "@/lib/auth/client";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { clearMessageDetailCache } from "@/lib/messages/detail-cache";
import { useCompose } from "@/components/compose/compose-context";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/sidebar-mobile-utils";
import { useSheetViewport } from "./use-sheet-viewport";
import { useTrackOpens } from "./use-track-opens";
import { FollowUpMenu } from "@/components/follow-ups/follow-up-menu";
import { followUpOptionKey } from "@/components/follow-ups/follow-up-client-utils";
import { formatScheduledSendTime } from "@/components/messages/scheduled-send-utils";
import { buildSendFormData, fetchDraft } from "./utils";
import { ComposeAttachmentList } from "./compose-attachment-list";
import { ComposeHeader } from "./compose-header";
import { COMPOSE_FIELD_LABEL, COMPOSE_FIELD_ROW, COMPOSE_ICON_BUTTON, COMPOSE_PRIMARY_GLOW } from "./compose-ui-utils";
import { RecipientInput } from "./recipient-input";
import { RichTextEditor } from "./rich-text-editor";
import { ScheduleSendMenu } from "./schedule-send-menu";
import { isPastSchedule } from "./schedule-send-utils";
import { DELIVERY_WAIT_MS, SCHEDULED_NOTICE_MS, SENT_NOTICE_MS, resolveSendNotice, splitSendTemplate } from "./send-notice-utils";
import type { SendNoticeParts, SendResult } from "./send-notice-utils";
import {
	applyMailboxSignatureHtml,
	hasMeaningfulHtml,
	htmlToPlainText,
	joinQuotedHtml,
	splitQuotedHtml,
	textToHtml,
} from "./rich-text-utils";
import { headerToRecipients, isValidRecipient, mergeRecipients, recipientsToHeader } from "./recipient-utils";
import type { ComposeAttachment, ComposeStoredAttachment, ComposeThreading } from "./types";
import type { ComposeAttachmentPolicy } from "./attachment-policy-types";

type Toast = { type: "success" | "error"; message: string } | null;

const CC_TOGGLE = "rounded-md px-1.5 py-0.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function ComposeForm({
	mode = "page",
	draftIdToLoad,
	initialTo,
	onClose,
}: {
	mode?: "page" | "popup";
	draftIdToLoad?: string | null;
	/** Recipients a fresh composer starts with, e.g. from the Contacts page. */
	initialTo?: string[] | null;
	onClose?: () => void;
}) {
	const { t } = useLanguage();
	const router = useRouter();
	const { showNotice, openDraftComposer, isCurrentNotice } = useCompose();
	// The composer keeps its own sender: it starts from the draft, the list's project or the selected mailbox,
	// and never writes the global selection, so composing or replying leaves the lists as they are.
	const { selectedMailbox: preferredMailbox, mailboxes } = useSelectedMailbox();
	const { projectId: activeProjectId } = useListScope();
	const { projects } = useProjects();
	const [draftId, setDraftId] = useState<string | null>(null);
	const [saveFailed, setSaveFailed] = useState(false);
	// Recipients handed in by the caller (Contacts "Send email", etc.) seed a fresh composer.
	const [to, setTo] = useState<string[]>(() => (draftIdToLoad ? [] : mergeRecipients([], initialTo ?? [])));
	const [cc, setCc] = useState<string[]>([]);
	const [bcc, setBcc] = useState<string[]>([]);
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);
	const [threading, setThreading] = useState<ComposeThreading | null>(null);
	const [subject, setSubject] = useState("");
	// The body is HTML; quoted/forwarded content is kept aside and folded.
	const [html, setHtml] = useState("");
	const [quotedHtml, setQuotedHtml] = useState<string | null>(null);
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
	// Attachments the draft already holds server-side (a forwarded message's files).
	const [storedAttachments, setStoredAttachments] = useState<ComposeStoredAttachment[]>([]);
	const [attachmentPolicy, setAttachmentPolicy] = useState<ComposeAttachmentPolicy>({ maxMb: 25, cloudThresholdBytes: 3_000_000 });
	const [draggingFiles, setDraggingFiles] = useState(false);
	const [modalMode, setModalMode] = useState(false);
	const [minimized, setMinimized] = useState(false);
	const [toast, setToast] = useState<Toast>(null);
	const [loading, setLoading] = useState(false);
	const [loadingDraft, setLoadingDraft] = useState(false);
	const [deletingDraft, setDeletingDraft] = useState(false);
	const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
	const [trackOpens, setTrackOpens] = useTrackOpens();
	const [followUpDays, setFollowUpDays] = useState<number | null>(null);
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const [loadedDraftFrom, setLoadedDraftFrom] = useState<string | null>(null);
	const [chosenMailboxId, setChosenMailboxId] = useState<string | null>(null);
	const [selectedFrom, setSelectedFrom] = useState("");
	const formRef = useRef<HTMLFormElement>(null);
	useSheetViewport(formRef, mode === "popup");
	const isPhone = useIsMobile();
	const phoneSheet = mode === "popup" && isPhone;
	const [closing, setClosing] = useState(false);
	const dragStart = useRef<number | null>(null);
	const [dragY, setDragY] = useState(0);
	const noticeActionInFlight = useRef(false);

	// Phones: slide the sheet away and let the page behind grow back before unmounting.
	function dismiss() {
		if (!onClose) return;
		if (!phoneSheet || closing) { onClose(); return; }
		setClosing(true);
		window.setTimeout(onClose, 260);
	}

	const sheetDrag = phoneSheet ? {
		onTouchStart: (event: React.TouchEvent) => { dragStart.current = event.touches[0].clientY; },
		onTouchMove: (event: React.TouchEvent) => {
			if (dragStart.current !== null) setDragY(Math.max(0, event.touches[0].clientY - dragStart.current));
		},
		onTouchEnd: () => {
			dragStart.current = null;
			if (dragY > 110) dismiss();
			setDragY(0);
		},
	} : {};
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingSave = useRef<(() => Promise<void>) | null>(null);
	const draftGeneration = useRef(0);
	const draftIdRef = useRef<string | null>(null);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());
	const uploadedFiles = useRef(new WeakSet<File>());
	const rejectedFiles = useRef(new WeakSet<File>());
	const attachmentInput = useRef<HTMLInputElement | null>(null);
	const fileDragDepth = useRef(0);
	const previousSignature = useRef("");

	useEffect(() => {
		let active = true;
		void authFetch("/api/attachment-policy", { cache: "no-store" }).then(async (response) => {
			if (response.ok && active) setAttachmentPolicy((await response.json()) as ComposeAttachmentPolicy);
		}).catch(() => {});
		return () => { active = false; };
	}, []);

	const senderOptions = useMemo(
		() => mailboxes.flatMap((mailbox) => {
			const addresses = mailbox.senderAddresses?.length
				? mailbox.senderAddresses
				: [`${mailbox.localPart}@${mailbox.hostname}`];
			return addresses.map((address) => ({ mailbox, address }));
		}),
		[mailboxes],
	);
	const projectMappings = useMemo(
		() => projects.flatMap((project) => project.addresses.map((address) => ({ projectId: project.id, hostname: address.hostname, localPart: address.localPart }))),
		[projects],
	);
	// Where a composer starts: a loaded draft's sender (replies open as drafts), else the active project's first
	// sender option, else the selected mailbox.
	const defaultSender = useMemo(() => pickComposerSender(
		senderOptions.map((option) => ({ mailboxId: option.mailbox.id, address: option.address })),
		{ draftMailboxId: loadedDraftMailboxId, draftFrom: loadedDraftFrom, projectId: activeProjectId, mappings: projectMappings, preferredMailboxId: preferredMailbox?.id },
	), [activeProjectId, loadedDraftFrom, loadedDraftMailboxId, preferredMailbox?.id, projectMappings, senderOptions]);
	const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === (chosenMailboxId ?? defaultSender?.mailboxId)) ?? null;
	const senderAddresses = useMemo(() => {
		if (!selectedMailbox) return [];
		return selectedMailbox.senderAddresses?.length
			? selectedMailbox.senderAddresses
			: [`${selectedMailbox.localPart}@${selectedMailbox.hostname}`];
	}, [selectedMailbox]);
	// Keep the sender on an address the mailbox can send as. A loaded draft's
	// sender wins whenever it or the mailbox's addresses change.
	const [prevSenderSync, setPrevSenderSync] = useState({ loadedDraftFrom, senderAddresses });
	let nextFrom = selectedFrom;
	if (loadedDraftFrom !== prevSenderSync.loadedDraftFrom || senderAddresses !== prevSenderSync.senderAddresses) {
		setPrevSenderSync({ loadedDraftFrom, senderAddresses });
		if (loadedDraftFrom && senderAddresses.includes(loadedDraftFrom)) nextFrom = loadedDraftFrom;
	}
	if (!senderAddresses.length) nextFrom = "";
	else if (!senderAddresses.includes(nextFrom)) {
		nextFrom = defaultSender && senderAddresses.includes(defaultSender.address) ? defaultSender.address : senderAddresses[0];
	}
	if (nextFrom !== selectedFrom) setSelectedFrom(nextFrom);
	const fromAddr = selectedMailbox && selectedFrom
		? formatEmailAddress(selectedFrom, selectedMailbox.displayName)
		: "";

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- flags the fetch below as in flight; the signature and autosave effects rely on it flipping after the first commit.
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;

				draftIdRef.current = draft.id;
				setDraftId(draft.id);
				setTo(headerToRecipients(draft.toAddr));
				const draftCc = headerToRecipients(draft.ccAddr);
				const draftBcc = headerToRecipients(draft.bccAddr);
				setCc(draftCc);
				setBcc(draftBcc);
				setShowCc(draftCc.length > 0);
				setShowBcc(draftBcc.length > 0);
				setThreading(
					draft.inReplyTo || draft.threadId
						? {
							inReplyTo: draft.inReplyTo ?? null,
							references: draft.references ?? null,
							threadId: draft.threadId ?? null,
						}
						: null,
				);
				setSubject(draft.subject ?? "");
				const stored = splitQuotedHtml(draft.htmlBody || textToHtml(draft.textBody));
				setHtml(stored.body);
				setQuotedHtml(stored.quoted);
				setStoredAttachments(draft.attachments?.filter((item) => item.disposition === "attachment") ?? []);
				setLoadedDraftMailboxId(draft.mailboxId);
				setLoadedDraftFrom(getEmailAddress(draft.fromAddr).toLowerCase());
			})
			.catch((err) => {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : t("compose.error.loadDraft");
				setToast({ type: "error", message });
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
	}, [draftIdToLoad]);

	useEffect(() => {
		if (loadingDraft) return;
		const nextSignature = selectedMailbox?.signature ?? "";
		setHtml((current) => applyMailboxSignatureHtml(current, previousSignature.current, nextSignature));
		previousSignature.current = nextSignature;
	}, [loadingDraft, selectedMailbox?.id, selectedMailbox?.signature]);

	useEffect(() => () => {
		void pendingSave.current?.();
	}, []);

	useEffect(() => {
		pendingSave.current = null;
		const bodyContent = htmlToPlainText(html).trim();
		// Compare text with text: an HTML signature is stored as markup.
		const signatureContent = htmlToPlainText(applyMailboxSignatureHtml("", "", selectedMailbox?.signature)).trim();
		const signatureOnly = bodyContent === signatureContent;
		const hasContent =
			to.length > 0 || cc.length > 0 || bcc.length > 0 || subject.trim() || quotedHtml || attachments.length > 0 || (bodyContent && !signatureOnly);
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		const generation = draftGeneration.current;
		const save = () => {
			const run = saveQueue.current.then(async () => {
				if (generation !== draftGeneration.current) return;
				const payload = {
					mailboxId: selectedMailbox?.id,
					from: fromAddr,
					to: recipientsToHeader(to),
					cc: recipientsToHeader(cc),
					bcc: recipientsToHeader(bcc),
					subject,
					html: joinQuotedHtml(html, quotedHtml),
					text: htmlToPlainText(joinQuotedHtml(html, quotedHtml)),
					inReplyTo: threading?.inReplyTo ?? null,
					references: threading?.references ?? null,
					threadId: threading?.threadId ?? null,
				};
				const existingId = draftIdRef.current;
				const res = await authFetch(existingId ? `/api/drafts/${existingId}` : "/api/drafts", {
					method: existingId ? "PATCH" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				const data = (await res.json()) as { draft?: { id: string } };
				if (!res.ok || !data.draft?.id) { setSaveFailed(true); return; }
				setSaveFailed(false);
				if (generation !== draftGeneration.current) {
					if (!existingId) void authFetch(`/api/drafts/${data.draft.id}`, { method: "DELETE" });
					return;
				}
				draftIdRef.current = data.draft.id;
				setDraftId(data.draft.id);
				const pending = attachments.filter((attachment) => !uploadedFiles.current.has(attachment.file) && !rejectedFiles.current.has(attachment.file));
				if (pending.length === 0) return;
				const form = new FormData();
				for (const attachment of pending) form.append("attachments", attachment.file);
				const uploaded = await authFetch(`/api/drafts/${data.draft.id}/attachments`, { method: "POST", body: form });
				const result = (await uploaded.json()) as { attachments?: ComposeStoredAttachment[]; error?: string };
				if (!uploaded.ok) {
					for (const attachment of pending) rejectedFiles.current.add(attachment.file);
					setToast({ type: "error", message: result.error || t("compose.error.draftAttachments") });
					return;
				}
				for (const attachment of pending) uploadedFiles.current.add(attachment.file);
				setStoredAttachments((current) => [...current, ...(result.attachments ?? [])]);
				setAttachments((current) => current.filter((attachment) => !uploadedFiles.current.has(attachment.file)));
			}).catch(() => { setSaveFailed(true); });
			saveQueue.current = run;
			return run;
		};
		pendingSave.current = save;
		saveTimer.current = setTimeout(() => {
			pendingSave.current = null;
			void save();
		}, 900);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [attachments, bcc, cc, fromAddr, html, loadingDraft, quotedHtml, selectedMailbox?.id, selectedMailbox?.signature, subject, threading, to]);

	useEffect(() => {
		if (!draftIdToLoad || loadingDraft) return;
		formRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
	}, [draftIdToLoad, loadingDraft]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (to.length === 0) {
			setToast({ type: "error", message: t("compose.error.noRecipient") });
			return;
		}
		const invalid = [...to, ...cc, ...bcc].find((entry) => !isValidRecipient(entry));
		if (invalid) {
			setToast({ type: "error", message: t("compose.error.invalidAddress", { address: invalid }) });
			return;
		}
		if (!hasMeaningfulHtml(html) && !quotedHtml) {
			setToast({ type: "error", message: t("compose.error.emptyBody") });
			return;
		}
		if (scheduledAt && isPastSchedule(scheduledAt)) {
			setToast({ type: "error", message: t("schedule.pastTime") });
			return;
		}
		if (saveTimer.current) clearTimeout(saveTimer.current);
		pendingSave.current = null;
		setLoading(true);
		await saveQueue.current;
		const currentDraftId = draftIdRef.current;
		const unsentAttachments = attachments.filter((attachment) => !uploadedFiles.current.has(attachment.file));
		const fullHtml = joinQuotedHtml(html, quotedHtml);
		let res: Response;
		let data: SendResult & { error?: string; code?: string; addresses?: string[] };
		try {
			res = await authFetch("/api/send", {
				method: "POST",
				body: buildSendFormData({
					attachments: unsentAttachments,
					from: fromAddr,
					to: recipientsToHeader(to),
					cc: recipientsToHeader(cc),
					bcc: recipientsToHeader(bcc),
					subject,
					text: htmlToPlainText(fullHtml),
					html: fullHtml,
					mailboxId: selectedMailbox?.id,
					threading: threading ?? undefined,
					draftId: currentDraftId,
					scheduledAt,
					undoSend: true,
					trackOpens,
					followUpDays,
				}),
			});
			data = (await res.json()) as SendResult & { error?: string; code?: string; addresses?: string[] };
		} catch {
			setLoading(false);
			setToast({ type: "error", message: t("compose.error.sendFailed") });
			return;
		}
		setLoading(false);

		if (!res.ok) {
			// A suppressed recipient is the one send error with its own translated sentence.
			const message = data.code === "SUPPRESSED_RECIPIENT" && data.addresses?.length
				? t("compose.error.suppressed", { addresses: data.addresses.join(", ") })
				: data.error ?? t("compose.error.sendFailed");
			setToast({ type: "error", message });
			return;
		}

		// With a draft, refresh once it is gone so the lists reload a single time.
		const refreshLists = () => window.dispatchEvent(new Event("mymailbox:messages-changed"));
		if (currentDraftId) void authFetch(`/api/drafts/${currentDraftId}`, { method: "DELETE" }).finally(refreshLists);
		draftGeneration.current += 1;
		draftIdRef.current = null;
		setDraftId(null);
		setTo([]);
		setCc([]);
		setBcc([]);
		setShowCc(false);
		setShowBcc(false);
		setThreading(null);
		setStoredAttachments([]);
		setSubject("");
		setHtml(applyMailboxSignatureHtml("", "", selectedMailbox?.signature));
		setQuotedHtml(null);
		setAttachments([]);
		setScheduledAt(null);
		const notice = resolveSendNotice(data);
		const subjectLabel = subject.trim() || t("list.noSubject");
		if (notice.kind === "undo") {
			const content = buildSubjectNotice("compose.sendingIn", subjectLabel, notice.messageId, true);
			let undoNoticeId = 0;
			// The send is queued for the undo window; Undo returns it to Drafts and Send now skips the wait.
			undoNoticeId = showNotice(content.message, {
				parts: content.parts,
				durationMs: notice.durationMs,
				countdown: { endAt: notice.endAt },
				// Delivery starts after the window; keep watching until the queue reports a result.
				onCountdownEnd: () => {
					if (!isCurrentNotice(undoNoticeId) || noticeActionInFlight.current) return;
					showSendingNotice(notice.messageId, subjectLabel);
				},
				actions: [
					{ label: t("compose.undoSend"), onClick: () => cancelSend(notice.messageId, "undo", undoNoticeId) },
					{ label: t("compose.sendNow"), onClick: () => sendNow(notice.messageId, subjectLabel, undoNoticeId) },
				],
			}) ?? 0;
		} else if (notice.kind === "sending") {
			showSendingNotice(notice.messageId, subjectLabel);
		} else if (notice.kind === "scheduled") {
			const message = notice.scheduledAt
				? t("schedule.sendScheduledFor", { when: formatScheduledSendTime(notice.scheduledAt, t) })
				: t("compose.scheduled");
			let scheduledNoticeId = 0;
			scheduledNoticeId = showNotice(message, {
				durationMs: SCHEDULED_NOTICE_MS,
				actions: [{ label: t("schedule.cancelSend"), onClick: () => cancelSend(notice.messageId, "scheduled", scheduledNoticeId) }],
			}) ?? 0;
		} else {
			showNotice(t("compose.sent"));
		}
		if (!currentDraftId) refreshLists();

		if (onClose) {
			dismiss();
			return;
		}
		router.push("/sent");
	}

	/**
	 * Splits a translated template around {subject} so the subject can link to the
	 * message, and around {seconds} so only the ticking suffix changes. Passing the
	 * placeholders back as values leaves them intact for the split.
	 *
	 * A message that is still queued is listed under Scheduled; only a delivered one
	 * lives in Sent, so the link follows the message's state.
	 */
	function buildSubjectNotice(
		key: "compose.sendingIn" | "compose.sendingSubject" | "compose.sentSubject",
		subjectLabel: string,
		messageId: string,
		countdown: boolean,
	): { message: string; parts: SendNoticeParts } {
		const template = t(key, { subject: "{subject}", seconds: "{seconds}" });
		const href = key === "compose.sentSubject" ? `/sent/${messageId}` : `/scheduled/${messageId}`;
		const parts: SendNoticeParts = {
			...splitSendTemplate(template, countdown),
			link: { label: subjectLabel, href },
		};
		return { message: t(key, { subject: subjectLabel, seconds: 1 }), parts };
	}

	/** Shows the message while the queue delivers it and watches for the final status. */
	function showSendingNotice(messageId: string, subjectLabel: string): number {
		const content = buildSubjectNotice("compose.sendingSubject", subjectLabel, messageId, false);
		let noticeId = 0;
		noticeId = showNotice(content.message, {
			parts: content.parts,
			durationMs: DELIVERY_WAIT_MS,
			poll: {
				messageId,
				onStatus: (status) => {
					if (status === "sent") {
						// Delivered: refresh the lists even if a newer toast has taken over.
						showSentNotice(messageId, subjectLabel, noticeId);
						return;
					}
					if (!isCurrentNotice(noticeId)) return;
					if (status === "failed") showNotice(t("compose.error.sendFailed"), { tone: "error" });
					else showNotice(null);
				},
			},
		}) ?? 0;
		return noticeId;
	}

	function showSentNotice(messageId: string, subjectLabel: string, sourceNoticeId: number) {
		// The message is delivered, so the lists and the cached detail are stale
		// whichever toast is on screen; refresh them before the notice check.
		clearMessageDetailCache();
		window.dispatchEvent(new Event("mymailbox:messages-changed"));
		if (!isCurrentNotice(sourceNoticeId)) return;
		const content = buildSubjectNotice("compose.sentSubject", subjectLabel, messageId, false);
		showNotice(content.message, { parts: content.parts, durationMs: SENT_NOTICE_MS });
	}

	async function sendNow(messageId: string, subjectLabel: string, sourceNoticeId: number) {
		if (noticeActionInFlight.current) return;
		noticeActionInFlight.current = true;
		try {
			const response = await authFetch(`/api/messages/${messageId}/send-now`, { method: "POST" });
			if (response.ok) {
				// The message is on its way: refresh the lists even if a newer toast has taken over.
				showSentNotice(messageId, subjectLabel, sourceNoticeId);
				return;
			}
			if (!isCurrentNotice(sourceNoticeId)) return;
			if (response.status === 409) {
				// The queued delivery claimed the message first; watch it instead of failing.
				showSendingNotice(messageId, subjectLabel);
				return;
			}
			if (response.status >= 500) {
				// The request may have failed before claiming the job; the scheduled send can
				// still deliver later, so let the status poll decide instead of reporting failure.
				showSendingNotice(messageId, subjectLabel);
				return;
			}
			const result = await response.json().catch(() => ({})) as { error?: string };
			if (!isCurrentNotice(sourceNoticeId)) return;
			showNotice(result.error ?? t("compose.error.sendFailed"), { tone: "error" });
		} catch {
			// A dropped response is ambiguous: the message may still be on its way.
			if (isCurrentNotice(sourceNoticeId)) showSendingNotice(messageId, subjectLabel);
		} finally {
			noticeActionInFlight.current = false;
		}
	}

	async function cancelSend(messageId: string, source: "undo" | "scheduled", sourceNoticeId: number) {
		if (noticeActionInFlight.current) return;
		noticeActionInFlight.current = true;
		try {
			const res = await authFetch(`/api/messages/${messageId}/cancel-schedule`, { method: "POST" });
			if (!res.ok) {
				if (!isCurrentNotice(sourceNoticeId)) return;
				// A 409 on the undo toast means the queue claimed it; a scheduled send can also fail for other reasons.
				showNotice(source === "undo" && res.status === 409 ? t("compose.cancelTooLate") : t("schedule.cancelFailed"), {
					tone: "error",
				});
				return;
			}
			// The message is back in Drafts, so the lists and the cached detail are
			// stale whichever toast is on screen; refresh them before the notice check.
			clearMessageDetailCache();
			window.dispatchEvent(new Event("mymailbox:messages-changed"));
			if (!isCurrentNotice(sourceNoticeId)) return;
			showNotice(t("compose.sendCancelled"));
			openDraftComposer(messageId);
		} catch {
			if (isCurrentNotice(sourceNoticeId)) showNotice(t("schedule.cancelFailed"), { tone: "error" });
		} finally {
			noticeActionInFlight.current = false;
		}
	}

	async function deleteDraftAndClose() {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		pendingSave.current = null;
		draftGeneration.current += 1;
		setDeletingDraft(true);
		await saveQueue.current;

		if (draftIdRef.current) {
			let deleted = false;
			try {
				const res = await authFetch(`/api/drafts/${draftIdRef.current}`, { method: "DELETE" });
				deleted = res.ok || res.status === 404;
			} catch {
				deleted = false;
			}
			if (!deleted) {
				setDeletingDraft(false);
				setToast({ type: "error", message: t("compose.error.deleteDraft") });
				return;
			}
		}

		draftIdRef.current = null;
		setDraftId(null);
		setTo([]);
		setCc([]);
		setBcc([]);
		setShowCc(false);
		setShowBcc(false);
		setThreading(null);
		setStoredAttachments([]);
		setSubject("");
		setHtml(applyMailboxSignatureHtml("", "", selectedMailbox?.signature));
		setQuotedHtml(null);
		setAttachments([]);
		setScheduledAt(null);
		window.dispatchEvent(new Event("mymailbox:messages-changed"));

		if (onClose) {
			dismiss();
			return;
		}
		setDeletingDraft(false);
		router.push("/inbox");
	}

	async function removeStoredAttachment(attachmentId: string) {
		const currentDraftId = draftIdRef.current;
		if (!currentDraftId) return;
		const res = await authFetch(`/api/drafts/${currentDraftId}/attachments/${attachmentId}`, { method: "DELETE" });
		if (!res.ok) {
			setToast({ type: "error", message: t("compose.error.removeAttachment") });
			return;
		}
		setStoredAttachments((current) => current.filter((item) => item.id !== attachmentId));
	}

	function addAttachments(files: FileList | null) {
		if (!files) return;
		const nextFiles = Array.from(files);
		const nextCount = storedAttachments.length + attachments.length + nextFiles.length;
		const totalSize =
			storedAttachments.reduce((total, item) => total + item.size, 0) +
			[...attachments.map((attachment) => attachment.file), ...nextFiles].reduce(
				(total, file) => total + file.size,
				0,
			);

		if (nextCount > 10) {
			setToast({ type: "error", message: t("compose.error.maxAttachments") });
			return;
		}
		if (nextFiles.some((file) => file.size > attachmentPolicy.maxMb * 1_000_000)) {
			setToast({ type: "error", message: t("compose.error.attachmentSize", { max: attachmentPolicy.maxMb }) });
			return;
		}
		if (totalSize > attachmentPolicy.maxMb * 1_000_000) {
			setToast({ type: "error", message: t("compose.error.totalSize", { max: attachmentPolicy.maxMb }) });
			return;
		}

		setAttachments((current) => [
			...current,
			...nextFiles.map((file) => ({ id: crypto.randomUUID(), file })),
		]);
		if (attachmentInput.current) attachmentInput.current.value = "";
	}

	function onFileDragEnter(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current += 1;
		if (!loading && !loadingDraft) setDraggingFiles(true);
	}

	function onFileDragOver(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = loading || loadingDraft ? "none" : "copy";
	}

	function onFileDragLeave(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
		if (fileDragDepth.current === 0) setDraggingFiles(false);
	}

	function onFileDrop(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		fileDragDepth.current = 0;
		setDraggingFiles(false);
		if (!loading && !loadingDraft) addAttachments(event.dataTransfer.files);
	}

	function selectSender(value: string) {
		const option = senderOptions.find((item) => `${item.mailbox.id}|${item.address}` === value);
		if (!option) return;
		setSelectedFrom(option.address);
		setChosenMailboxId(option.mailbox.id);
	}

	const attachmentContent = (
		<ComposeAttachmentList
			attachments={attachments}
			storedAttachments={storedAttachments}
			cloudThresholdBytes={attachmentPolicy.cloudThresholdBytes}
			onRemove={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
			onRemoveStored={(attachmentId) => void removeStoredAttachment(attachmentId)}
		/>
	);

	// Below md the popup is a bottom sheet: full width, anchored to the visual viewport (so the keyboard never covers the toolbar) and padded by the bottom safe area.
	const sheetClass = "compose-sheet max-md:inset-x-0 max-md:bottom-[var(--sheet-bottom,0px)] max-md:left-0 max-md:right-0 max-md:top-auto max-md:z-50 max-md:h-[var(--sheet-height,100dvh)] max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[var(--sheet-pad,max(env(safe-area-inset-bottom),1rem))]";
	// A floating window lifts off the page with a soft offset shadow; it enters with a short fade and scale on
	// desktop (opacity and scale only, so switching to the modal never animates its position).
	const windowSurface = "border border-line bg-surface-1 text-ink";
	const floatingShadow = "shadow-[0_-6px_32px_-12px_rgb(13_15_18/0.28)] dark:shadow-[0_-8px_40px_-10px_rgb(0_0_0/0.75)]";
	const enterMotion = "transition-[opacity,scale] duration-[240ms] ease-out-soft md:starting:scale-[0.97] md:starting:opacity-0 motion-reduce:transition-none";
	const frameClass =
		mode === "popup"
			? minimized
				? cn("fixed bottom-0 right-8 z-40 flex h-10 w-[min(300px,calc(100vw-32px))] origin-bottom-right flex-col overflow-hidden rounded-t-xl", windowSurface, floatingShadow, enterMotion, sheetClass)
				: modalMode
				? cn("fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 origin-center flex-col overflow-hidden rounded-2xl shadow-[0_24px_64px_-24px_rgb(0_0_0/0.6)]", windowSurface, enterMotion, sheetClass)
				: cn("fixed bottom-0 right-8 z-40 flex h-[min(540px,calc(100vh-88px))] w-[min(580px,calc(100vw-32px))] origin-bottom-right flex-col overflow-hidden rounded-t-xl", windowSurface, floatingShadow, enterMotion, sheetClass)
			: cn("relative flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl", windowSurface);

	return (
		<>
			{mode === "popup" && modalMode && !minimized && <div className="fixed inset-0 z-40 bg-black/65 dark:bg-black/75" aria-hidden="true" />}
			{toast && (
				<div
					role={toast.type === "error" ? "alert" : "status"}
					className={cn(
						"fixed z-[60] max-w-[calc(100vw-3rem)] rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
						"inset-x-6 bottom-[max(5rem,calc(env(safe-area-inset-bottom,0px)+4.5rem))] md:bottom-6 md:[inset-inline-end:auto] md:[inset-inline-start:calc(var(--sidebar-width,260px)+1.5rem)]",
						toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white",
					)}
				>
					{toast.message}
				</div>
			)}
			<form onSubmit={onSubmit} className={cn(frameClass, closing && "compose-sheet-closing")} data-compose-surface={mode === "popup" ? "" : undefined} style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined} ref={formRef} role={modalMode && !minimized ? "dialog" : mode === "popup" ? "region" : undefined} aria-modal={modalMode && !minimized || undefined} aria-label={mode === "popup" ? t("compose.dialogLabel") : undefined} onKeyDown={(event) => { if (modalMode && !minimized && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setModalMode(false); } }} onDragEnterCapture={minimized ? undefined : onFileDragEnter} onDragOverCapture={minimized ? undefined : onFileDragOver} onDragLeaveCapture={minimized ? undefined : onFileDragLeave} onDropCapture={minimized ? undefined : onFileDrop}>
				{draggingFiles && !minimized && (
					<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-medium text-accent" aria-hidden="true">
						{t("compose.dropFiles")}
					</div>
				)}
				<ComposeHeader
					title={loadingDraft
						? t("compose.title.loading")
						: threading?.inReplyTo
							? t("compose.title.reply")
							: /^fwd?:/i.test(subject)
								? t("compose.title.forward")
								: draftId && !saveFailed
									? t("compose.title.saved")
									: t("compose.title.new")}
					kind={threading?.inReplyTo ? "reply" : /^fwd?:/i.test(subject) ? "forward" : null}
					subject={subject}
					popup={mode === "popup"}
					minimized={minimized}
					modalMode={modalMode}
					onToggleMinimized={() => { setMinimized((current) => !current); setDraggingFiles(false); }}
					onToggleModal={() => { if (minimized) setMinimized(false); setModalMode((current) => !current); }}
					onClose={dismiss}
					sheetDrag={sheetDrag}
				/>
				<div className={cn("flex min-h-0 flex-1 flex-col", minimized && "hidden")}>
				<div className={COMPOSE_FIELD_ROW}>
					<Label htmlFor={`${mode}-from`} className={COMPOSE_FIELD_LABEL}>{t("compose.from")}</Label>
					<Select
						id={`${mode}-from`}
						value={selectedMailbox && selectedFrom ? `${selectedMailbox.id}|${selectedFrom}` : ""}
						onChange={(event) => selectSender(event.target.value)}
						// placeholder="Select a mailbox first"
						required
						disabled={loadingDraft || senderOptions.length === 0}
						className="h-8 px-0 py-1 text-sm text-ink shadow-none focus-visible:ring-0"
						containerClassName="-mx-2 flex-1 border-0 rounded-md transition-colors hover:bg-surface-2"
					>
						{senderOptions.length === 0 && <option value="">{t("compose.selectMailboxFirst")}</option>}
						{senderOptions.map(({ mailbox, address }) => (
							<option key={`${mailbox.id}|${address}`} value={`${mailbox.id}|${address}`}>{address}</option>
						))}
					</Select>
				</div>
				<RecipientInput
					id={`${mode}-to`}
					label={t("compose.to")}
					value={to}
					onChange={setTo}
					placeholder={t("compose.toPlaceholder")}
					mailboxId={selectedMailbox?.id}
					required
					autoFocus={!draftIdToLoad}
					disabled={loadingDraft}
					trailing={
						<>
							{!showCc && (
								<button type="button" className={CC_TOGGLE} onClick={() => setShowCc(true)}>
									{t("compose.cc")}
								</button>
							)}
							{!showBcc && (
								<button type="button" className={CC_TOGGLE} onClick={() => setShowBcc(true)}>
									{t("compose.bcc")}
								</button>
							)}
						</>
					}
				/>
				{showCc && (
					<RecipientInput
						id={`${mode}-cc`}
						label={t("compose.cc")}
						value={cc}
						onChange={setCc}
						placeholder={t("compose.ccPlaceholder")}
						mailboxId={selectedMailbox?.id}
						disabled={loadingDraft}
						autoFocus={!loadingDraft && cc.length === 0}
					/>
				)}
				{showBcc && (
					<RecipientInput
						id={`${mode}-bcc`}
						label={t("compose.bcc")}
						value={bcc}
						onChange={setBcc}
						placeholder={t("compose.bccPlaceholder")}
						mailboxId={selectedMailbox?.id}
						disabled={loadingDraft}
						autoFocus={!loadingDraft && bcc.length === 0}
					/>
				)}
				<div className={COMPOSE_FIELD_ROW}>
					<Label htmlFor={`${mode}-subject`} className="sr-only">{t("compose.subject")}</Label>
					<Input
						id={`${mode}-subject`}
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder={t("compose.subject")}
						required
						disabled={loadingDraft}
						className="h-8 border-0 px-0 py-1 text-[15px] font-medium text-ink shadow-none placeholder:font-normal placeholder:text-ink-muted focus-visible:ring-0"
					/>
				</div>
				<Label htmlFor={`${mode}-text`} className="sr-only">{t("compose.body")}</Label>
				<RichTextEditor
					id={`${mode}-text`}
					value={html}
					onChange={setHtml}
					quotedHtml={quotedHtml}
					disabled={loadingDraft}
					placeholder={t("compose.bodyPlaceholder")}
					footerContent={attachmentContent}
					toolbarStart={
						<div className="flex items-center max-md:contents">
							<Button type="button" variant="secondary" size="sm" onClick={dismiss} className="bg-surface-2 text-ink hover:bg-surface-3 md:hidden max-md:h-10 max-md:px-3.5 max-md:text-[15px]">
								{t("common.cancel")}
							</Button>
							<div className={cn("flex items-center rounded-lg max-md:order-last max-md:ml-auto", COMPOSE_PRIMARY_GLOW)}>
								<Button
									type="submit"
									size="sm"
									disabled={loading || loadingDraft || !fromAddr}
									className="rounded-r-none px-4 font-semibold focus-visible:ring-accent focus-visible:ring-offset-surface-1 max-md:h-10 max-md:px-5 max-md:text-[15px]"
								>
									{loading ? t("compose.preparing") : scheduledAt ? t("compose.schedule") : t("compose.send")}
								</Button>
								<ScheduleSendMenu
									disabled={loading || loadingDraft || !fromAddr}
									value={scheduledAt}
									onChange={setScheduledAt}
									mailboxId={selectedMailbox?.id}
									from={fromAddr}
									onApplyTemplate={({ title, html: templateHtml }) => {
										setSubject((current) => current.trim() ? current : title);
										setHtml((current) => (hasMeaningfulHtml(current) ? `${current}${templateHtml}` : templateHtml));
									}}
								/>
							</div>
						</div>
					}
					toolbarEnd={
						<>
								<Input
								ref={attachmentInput}
								type="file"
								multiple
								className="hidden"
								onChange={(event) => addAttachments(event.target.files)}
							/>
							<Tooltip label={t("compose.attachTooltip", { max: attachmentPolicy.maxMb })}>
								<button
									type="button"
									aria-label={t("compose.attachFiles")}
									onClick={() => attachmentInput.current?.click()}
									disabled={loading || loadingDraft}
									className={COMPOSE_ICON_BUTTON}
								>
									<Paperclip className="h-4 w-4" />
								</button>
							</Tooltip>
							<Tooltip label={trackOpens ? t("compose.trackOpensOn") : t("compose.trackOpensOff")}>
								<button
									type="button"
									aria-label={t("compose.trackOpens")}
									aria-pressed={trackOpens}
									onClick={() => setTrackOpens(!trackOpens)}
									disabled={loading || loadingDraft}
									className={cn(COMPOSE_ICON_BUTTON, trackOpens && "text-accent hover:text-accent")}
								>
									{trackOpens ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
								</button>
							</Tooltip>
							<Tooltip label={followUpDays ? t("followUp.remindOn", { when: t(followUpOptionKey(followUpDays)) }) : t("followUp.remindMe")}>
								<FollowUpMenu
									disabled={loading || loadingDraft}
									onPick={setFollowUpDays}
									onClear={followUpDays ? () => setFollowUpDays(null) : undefined}
									trigger={
										<button
											type="button"
											aria-label={t("followUp.remindMe")}
											className={cn(COMPOSE_ICON_BUTTON, followUpDays && "text-warm hover:text-warm")}
										>
											<BellRing className="h-4 w-4" />
										</button>
									}
								/>
							</Tooltip>
							<span className="flex-1 max-md:hidden" />
							<Tooltip label={t("compose.deleteDraft")}>
								<button
									type="button"
									aria-label={t("compose.deleteDraft")}
									onClick={() => void deleteDraftAndClose()}
									disabled={loading || loadingDraft || deletingDraft}
									className={cn(COMPOSE_ICON_BUTTON, "hover:bg-red-50 hover:text-red-600")}
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</Tooltip>
						</>
					}
				/>
				</div>
			</form>
		</>
	);
}
