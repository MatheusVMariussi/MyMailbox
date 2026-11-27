"use client";

import { AUTH_SESSION_CHANGED_EVENT, authFetch, getClientSessionKey } from "@/lib/auth/client";
import type { ProjectListResponse } from "./client-types";
import type { ProjectRestampResult } from "./types";

/** Fired after a project is created, changed or deleted, or its addresses change. */
export const PROJECTS_CHANGED_EVENT = "mymailbox:projects-changed";

const EMPTY: ProjectListResponse = { projects: [], domains: [] };
let cached: { sessionToken: string | null; data: ProjectListResponse } | null = null;
let request: { sessionToken: string | null; promise: Promise<ProjectListResponse> } | null = null;
let epoch = 0;
let listenersInstalled = false;

function invalidate(): void {
	epoch += 1;
	cached = null;
	request = null;
}

function installListeners(): void {
	if (listenersInstalled || typeof window === "undefined") return;
	listenersInstalled = true;
	window.addEventListener(AUTH_SESSION_CHANGED_EVENT, invalidate);
	window.addEventListener(PROJECTS_CHANGED_EVENT, invalidate);
}

/** The user's projects and mappable domains, cached for the session and shared between callers. */
export async function fetchProjects(): Promise<ProjectListResponse> {
	installListeners();
	const sessionToken = getClientSessionKey();
	if (cached?.sessionToken === sessionToken) return cached.data;
	if (request?.sessionToken === sessionToken) return request.promise;
	const requestEpoch = epoch;
	const promise = authFetch("/api/projects", { cache: "no-store" }).then(async (response) => {
		const data = (await response.json().catch(() => null)) as (ProjectListResponse & { error?: string }) | null;
		if (!response.ok || !data) throw new Error(data?.error ?? "Unable to load projects");
		const result = { projects: data.projects ?? [], domains: data.domains ?? [] };
		if (requestEpoch === epoch) cached = { sessionToken, data: result };
		return result;
	}).finally(() => {
		if (request?.promise === promise) request = null;
	});
	request = { sessionToken, promise };
	return promise;
}

/** The cached list, if any, so a first render can paint without waiting. */
export function peekProjects(): ProjectListResponse | null {
	return cached?.sessionToken === getClientSessionKey() ? cached.data : null;
}

/** Drops the cached list and tells every consumer (sidebar, rows, composer, settings) to reload. */
export function invalidateProjectsCache(): void {
	invalidate();
	if (typeof window !== "undefined") window.dispatchEvent(new window.Event(PROJECTS_CHANGED_EVENT));
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
	const response = await authFetch(url, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
	return data;
}

export function createProjectRequest(input: { name: string; color: string }) {
	return send<{ id: string }>("/api/projects", "POST", input);
}

export function updateProjectRequest(projectId: string, patch: { name?: string; color?: string; sortOrder?: number }) {
	return send<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}`, "PATCH", patch);
}

export function deleteProjectRequest(projectId: string) {
	return send<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, "DELETE");
}

export function setProjectAddressesRequest(projectId: string, addresses: { domainId: string; localPart: string }[]) {
	return send<{ addresses: unknown[] }>(`/api/projects/${encodeURIComponent(projectId)}/addresses`, "PUT", { addresses });
}

/** Re-stamps every accessible message, one bounded call after another, and reports the rows it changed. */
export async function restampProjectMessages(projectId: string, onProgress?: (updated: number) => void): Promise<number> {
	let cursor: string | null = null;
	let updated = 0;
	for (let guard = 0; guard < 10_000; guard++) {
		const result: ProjectRestampResult = await send<ProjectRestampResult>(`/api/projects/${encodeURIComponent(projectId)}/restamp`, "POST", { cursor });
		updated += result.updated;
		onProgress?.(updated);
		if (result.done || !result.cursor) break;
		cursor = result.cursor;
	}
	if (typeof window !== "undefined") window.dispatchEvent(new window.Event("mymailbox:messages-changed"));
	return updated;
}

export { EMPTY as EMPTY_PROJECT_LIST };
