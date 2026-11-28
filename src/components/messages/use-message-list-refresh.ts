"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refreshMessageViews } from "@/hooks/message-refresh";

/** One refresh shared by the header button and pull-to-refresh, so both show the same state and never overlap. */
export function useMessageListRefresh(onError: () => void): { refreshing: boolean; refresh: () => Promise<void> } {
	const [refreshing, setRefreshing] = useState(false);
	const pending = useRef(false);
	const errorHandler = useRef(onError);
	useEffect(() => {
		errorHandler.current = onError;
	}, [onError]);

	const refresh = useCallback(async () => {
		if (pending.current) return;
		pending.current = true;
		setRefreshing(true);
		try {
			await refreshMessageViews();
		} catch {
			errorHandler.current();
		} finally {
			pending.current = false;
			setRefreshing(false);
		}
	}, []);

	return { refreshing, refresh };
}
