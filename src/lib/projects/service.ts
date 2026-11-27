import { and, asc, eq, gt, inArray, max, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { domains, messages, projectAddresses, projects } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/database-errors";
import { selectInBatches } from "@/lib/db-params";
import { newId } from "@/lib/ids";
import { chunk } from "@/lib/labels/label-utils";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import type { SessionUser } from "@/lib/auth/types";
import { findLocalPartConflicts, pickProjectForLocalPart, resolveMessageProject, splitProjectAddress } from "./resolve-utils";
import { formatProjectAddress, formatRestampCursor, parseRestampCursor, PROJECT_ADDRESS_INSERT_CHUNK } from "./project-utils";
import type {
	ProjectAddressInput,
	ProjectAddressView,
	ProjectDomainOption,
	ProjectHostMapping,
	ProjectRecord,
	ProjectRestampResult,
	ProjectView,
	ResolvedProject,
} from "./types";

/** Messages read per re-stamp page; every changed row fires the message change-log triggers. */
export const RESTAMP_PAGE_SIZE = 500;
/** Pages one re-stamp call reads before it hands back a cursor. */
export const RESTAMP_MAX_PAGES = 4;
/** Message ids per re-stamp update: one parameter each plus the project. */
const RESTAMP_UPDATE_CHUNK = 90;

export class ProjectError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "ProjectError";
	}
}

const projectColumns = {
	id: projects.id,
	userId: projects.userId,
	name: projects.name,
	color: projects.color,
	sortOrder: projects.sortOrder,
	createdAt: projects.createdAt,
};

/** A user's projects in their order, each with the addresses it owns. */
export async function listProjects(db: AppDatabase, userId: string): Promise<ProjectView[]> {
	const rows = await db.select(projectColumns).from(projects).where(eq(projects.userId, userId)).orderBy(asc(projects.sortOrder), asc(projects.createdAt), asc(projects.id));
	const addresses = await loadProjectAddresses(db, rows.map((row) => row.id));
	return rows.map((row) => ({ ...row, addresses: addresses.get(row.id) ?? [] }));
}

export async function getProject(db: AppDatabase, projectId: string): Promise<ProjectRecord | null> {
	const [row] = await db.select(projectColumns).from(projects).where(eq(projects.id, projectId)).limit(1);
	return row ?? null;
}

/** The project when it belongs to the user; null hides everyone else's. */
export async function getOwnProject(db: AppDatabase, userId: string, projectId: string): Promise<ProjectRecord | null> {
	const project = await getProject(db, projectId);
	return project && project.userId === userId ? project : null;
}

async function loadProjectAddresses(db: AppDatabase, projectIds: readonly string[]): Promise<Map<string, ProjectAddressView[]>> {
	const rows = await selectInBatches(projectIds, (batch) => db
		.select({ id: projectAddresses.id, projectId: projectAddresses.projectId, domainId: projectAddresses.domainId, hostname: domains.hostname, localPart: projectAddresses.localPart })
		.from(projectAddresses)
		.innerJoin(domains, eq(domains.id, projectAddresses.domainId))
		.where(inArray(projectAddresses.projectId, batch)));
	rows.sort((left, right) => left.hostname.localeCompare(right.hostname) || left.localPart.localeCompare(right.localPart));
	const result = new Map<string, ProjectAddressView[]>();
	for (const { projectId, ...address } of rows) result.set(projectId, [...(result.get(projectId) ?? []), address]);
	return result;
}

export async function createProject(
	db: AppDatabase,
	input: { userId: string; name: string; color: string },
): Promise<ProjectView> {
	const [last] = await db.select({ value: max(projects.sortOrder) }).from(projects).where(eq(projects.userId, input.userId));
	const record: ProjectRecord = {
		id: newId("prj"),
		userId: input.userId,
		name: input.name,
		color: input.color,
		sortOrder: (last?.value ?? -1) + 1,
		createdAt: new Date(Math.floor(Date.now() / 1000) * 1000),
	};
	try {
		await db.insert(projects).values(record);
	} catch (error) {
		if (isUniqueConstraintError(error)) throw new ProjectError("A project with that name already exists", 409);
		throw error;
	}
	return { ...record, addresses: [] };
}

export async function updateProject(
	db: AppDatabase,
	project: ProjectRecord,
	patch: { name?: string; color?: string; sortOrder?: number },
): Promise<ProjectRecord> {
	const values: { name?: string; color?: string; sortOrder?: number } = {};
	if (patch.name !== undefined && patch.name !== project.name) values.name = patch.name;
	if (patch.color !== undefined && patch.color !== project.color) values.color = patch.color;
	if (patch.sortOrder !== undefined && patch.sortOrder !== project.sortOrder) values.sortOrder = patch.sortOrder;
	if (Object.keys(values).length === 0) return project;
	try {
		await db.update(projects).set(values).where(eq(projects.id, project.id));
	} catch (error) {
		if (isUniqueConstraintError(error)) throw new ProjectError("A project with that name already exists", 409);
		throw error;
	}
	return { ...project, ...values };
}

/**
 * Deletes the project and its addresses. Messages keep the id (there is no foreign key, so nothing rewrites
 * them all at once); it matches no project any more and the next re-stamp clears it.
 */
export async function deleteProject(db: AppDatabase, projectId: string): Promise<void> {
	await db.delete(projects).where(eq(projects.id, projectId));
}

/** Domains the user may map: the ones they own and the ones their accessible mailboxes live on. */
export async function listProjectDomains(db: AppDatabase, user: Pick<SessionUser, "id" | "email" | "role">): Promise<ProjectDomainOption[]> {
	const mailboxes = await listAccessibleMailboxes(db, user);
	const mailboxDomainIds = [...new Set(mailboxes.map((mailbox) => mailbox.domainId))];
	const [owned, viaMailboxes] = await Promise.all([
		db.select({ id: domains.id, hostname: domains.hostname }).from(domains).where(eq(domains.userId, user.id)),
		selectInBatches(mailboxDomainIds, (batch) => db.select({ id: domains.id, hostname: domains.hostname }).from(domains).where(inArray(domains.id, batch))),
	]);
	const byId = new Map([...owned, ...viaMailboxes].map((domain) => [domain.id, domain]));
	return [...byId.values()].sort((left, right) => left.hostname.localeCompare(right.hostname));
}

/**
 * Replaces the addresses a project owns. The caller has normalized the local parts and checked the domains;
 * an address that normalizes like one another project owns is refused (409), and so is a race on the
 * unique index. Delete and inserts run as one batch, so a failure leaves the old set in place.
 */
export async function setProjectAddresses(
	db: AppDatabase,
	project: ProjectRecord,
	requested: readonly ProjectAddressInput[],
	hostnames: ReadonlyMap<string, string>,
): Promise<ProjectAddressView[]> {
	const unique = [...new Map(requested.map((entry) => [`${entry.domainId}\u0000${entry.localPart}`, entry])).values()];
	const existing = await selectInBatches([...new Set(unique.map((entry) => entry.domainId))], (batch) => db
		.select({ projectId: projectAddresses.projectId, domainId: projectAddresses.domainId, localPart: projectAddresses.localPart })
		.from(projectAddresses)
		.where(inArray(projectAddresses.domainId, batch)));
	const conflicts = findLocalPartConflicts(existing, unique, project.id);
	if (conflicts.length > 0) {
		const first = conflicts[0];
		throw new ProjectError(`${formatProjectAddress({ localPart: first.localPart, hostname: hostnames.get(first.domainId) ?? "" })} already belongs to another project`, 409);
	}
	const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
	const rows = unique.map((entry) => ({ id: newId("pad"), projectId: project.id, domainId: entry.domainId, localPart: entry.localPart, createdAt }));
	const statements = [
		db.delete(projectAddresses).where(eq(projectAddresses.projectId, project.id)),
		...chunk(rows, PROJECT_ADDRESS_INSERT_CHUNK).map((part) => db.insert(projectAddresses).values(part)),
	];
	try {
		await db.batch(statements as never);
	} catch (error) {
		if (isUniqueConstraintError(error)) throw new ProjectError("One of these addresses already belongs to another project", 409);
		throw error;
	}
	return rows
		.map((row) => ({ id: row.id, domainId: row.domainId, hostname: hostnames.get(row.domainId) ?? "", localPart: row.localPart }))
		.sort((left, right) => left.hostname.localeCompare(right.hostname) || left.localPart.localeCompare(right.localPart));
}

/**
 * The project of `userId` owning an address: an exact (normalized) local part on its domain, else the
 * domain default. Projects are per user, so only that user's mappings count: the owner of the receiving
 * mailbox for inbound mail, the acting user for sends and drafts. Another user who maps the same address
 * on a shared domain never stamps this user's mail.
 */
export async function resolveProjectForAddress(db: AppDatabase, userId: string, address: string): Promise<ResolvedProject | null> {
	const parts = splitProjectAddress(address);
	if (!parts) return null;
	const rows = await db
		.select({ projectId: projectAddresses.projectId, localPart: projectAddresses.localPart, name: projects.name })
		.from(projectAddresses)
		.innerJoin(domains, eq(domains.id, projectAddresses.domainId))
		.innerJoin(projects, eq(projects.id, projectAddresses.projectId))
		.where(and(eq(domains.hostname, parts.hostname), eq(projects.userId, userId)))
		.orderBy(asc(projectAddresses.createdAt), asc(projectAddresses.id));
	const projectId = pickProjectForLocalPart(rows, parts.localPart);
	if (!projectId) return null;
	return { id: projectId, name: rows.find((row) => row.projectId === projectId)?.name ?? "" };
}

export async function resolveProjectIdForAddress(db: AppDatabase, userId: string, address: string): Promise<string | null> {
	return (await resolveProjectForAddress(db, userId, address))?.id ?? null;
}

/** Like `resolveProjectForAddress`, but a failure is logged and resolves to none: stamping never blocks mail. */
export async function resolveProjectSafely(db: AppDatabase, userId: string, address: string | null | undefined): Promise<ResolvedProject | null> {
	if (!address) return null;
	try {
		return await resolveProjectForAddress(db, userId, address);
	} catch (error) {
		console.error("Project lookup failed", error);
		return null;
	}
}

/** Every project mapping of one user with its hostname, oldest first (the order ties resolve in). */
export async function loadProjectMappings(db: AppDatabase, userId: string): Promise<ProjectHostMapping[]> {
	return db
		.select({ projectId: projectAddresses.projectId, localPart: projectAddresses.localPart, hostname: domains.hostname })
		.from(projectAddresses)
		.innerJoin(domains, eq(domains.id, projectAddresses.domainId))
		.innerJoin(projects, eq(projects.id, projectAddresses.projectId))
		.where(eq(projects.userId, userId))
		.orderBy(asc(projectAddresses.createdAt), asc(projectAddresses.id));
}

/**
 * Recomputes the project of `userId`'s stored messages in these mailboxes against that user's current
 * mappings and writes the ones that changed (stale ids of deleted projects included). Rows of other users
 * (in a shared mailbox) keep their stamp. Bounded: it reads at most `maxPages` pages of `RESTAMP_PAGE_SIZE`
 * rows, walking each mailbox by rowid, and returns a cursor to continue from.
 */
export async function restampMessages(
	db: AppDatabase,
	userId: string,
	mailboxIds: readonly string[],
	cursor: string | null | undefined,
	maxPages = RESTAMP_MAX_PAGES,
): Promise<ProjectRestampResult> {
	const ids = [...new Set(mailboxIds)].sort();
	let { mailboxIndex, afterRowId } = parseRestampCursor(cursor);
	const mappings = await loadProjectMappings(db, userId);
	let scanned = 0;
	let updated = 0;
	for (let page = 0; page < maxPages; page++) {
		if (mailboxIndex >= ids.length) return { done: true, scanned, updated, cursor: null };
		const rows = await db
			.select({
				rowId: sql<number>`${messages}.rowid`,
				id: messages.id,
				direction: messages.direction,
				deliveredTo: messages.deliveredTo,
				fromAddr: messages.fromAddr,
				toAddr: messages.toAddr,
				ccAddr: messages.ccAddr,
				projectId: messages.projectId,
				userId: messages.userId,
			})
			.from(messages)
			.where(and(eq(messages.mailboxId, ids[mailboxIndex]), gt(sql`${messages}.rowid`, afterRowId)))
			.orderBy(sql`${messages}.rowid`)
			.limit(RESTAMP_PAGE_SIZE);
		scanned += rows.length;
		const changes = new Map<string | null, string[]>();
		for (const row of rows) {
			// Pages still walk every row so the cursor advances; other users' rows are only skipped.
			if (row.userId !== userId) continue;
			const projectId = resolveMessageProject(mappings, row);
			if (projectId === (row.projectId ?? null)) continue;
			changes.set(projectId, [...(changes.get(projectId) ?? []), row.id]);
		}
		for (const [projectId, messageIds] of changes) {
			for (const part of chunk(messageIds, RESTAMP_UPDATE_CHUNK)) {
				await db.update(messages).set({ projectId }).where(inArray(messages.id, part));
				updated += part.length;
			}
		}
		if (rows.length < RESTAMP_PAGE_SIZE) {
			mailboxIndex += 1;
			afterRowId = 0;
		} else {
			afterRowId = Number(rows[rows.length - 1].rowId);
		}
	}
	if (mailboxIndex >= ids.length) return { done: true, scanned, updated, cursor: null };
	return { done: false, scanned, updated, cursor: formatRestampCursor(mailboxIndex, afterRowId) };
}

/** `messages` rows stamped with the project. */
export function projectFilterCondition(projectId: string): SQL {
	return eq(messages.projectId, projectId);
}
