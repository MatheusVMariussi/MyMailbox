"use client";

import { useEffect, useState } from "react";
import { getMailboxLabels, LABELS_CHANGED_EVENT } from "@/lib/labels/client";
import { getClientSessionToken } from "@/lib/auth/client";
import type { NavLabel } from "@/components/dashboard-nav-types";

/** The labels of one mailbox, reloaded whenever a label changes. */
export function useMailboxLabels(mailboxId: string | undefined): NavLabel[] {
	const [fetched, setFetched] = useState<{ mailboxId: string; sessionToken: string | null; labels: NavLabel[] } | null>(null);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		const reload = () => setVersion((value) => value + 1);
		window.addEventListener(LABELS_CHANGED_EVENT, reload);
		return () => window.removeEventListener(LABELS_CHANGED_EVENT, reload);
	}, []);

	useEffect(() => {
		if (!mailboxId) return;
		let cancelled = false;
		getMailboxLabels<{ labels?: NavLabel[] }>(mailboxId)
			.then((data) => {
				if (!cancelled) setFetched({ mailboxId, sessionToken: getClientSessionToken(), labels: data.labels ?? [] });
			})
			.catch(() => undefined);
		return () => { cancelled = true; };
	}, [mailboxId, version]);

	if (!mailboxId) return [];
	return fetched?.mailboxId === mailboxId && fetched.sessionToken === getClientSessionToken() ? fetched.labels : [];
}
