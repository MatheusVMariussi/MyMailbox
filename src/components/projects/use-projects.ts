"use client";

import { useEffect, useState } from "react";
import { getClientSessionToken } from "@/lib/auth/client";
import { EMPTY_PROJECT_LIST, fetchProjects, peekProjects, PROJECTS_CHANGED_EVENT } from "@/lib/projects/client";
import type { ProjectListResponse } from "@/lib/projects/client-types";

type ProjectsState = ProjectListResponse & { isLoading: boolean };

/** The user's projects (in their order) and mappable domains, reloaded whenever a project changes. */
export function useProjects(): ProjectsState {
	const [fetched, setFetched] = useState<{ sessionToken: string | null; data: ProjectListResponse } | null>(() => {
		const data = peekProjects();
		return data ? { sessionToken: getClientSessionToken(), data } : null;
	});
	const [version, setVersion] = useState(0);

	useEffect(() => {
		const reload = () => setVersion((value) => value + 1);
		window.addEventListener(PROJECTS_CHANGED_EVENT, reload);
		return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, reload);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const sessionToken = getClientSessionToken();
		fetchProjects()
			.then((data) => {
				if (!cancelled) setFetched({ sessionToken, data });
			})
			.catch(() => {
				if (!cancelled) setFetched({ sessionToken, data: EMPTY_PROJECT_LIST });
			});
		return () => { cancelled = true; };
	}, [version]);

	const current = fetched && fetched.sessionToken === getClientSessionToken() ? fetched.data : null;
	return { ...(current ?? EMPTY_PROJECT_LIST), isLoading: !current };
}
