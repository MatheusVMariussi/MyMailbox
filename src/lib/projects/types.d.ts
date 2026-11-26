/** A project row: a named, colored identity owning whole domains or single addresses. Belongs to one user. */
export type ProjectRecord = {
	id: string;
	userId: string;
	name: string;
	color: string;
	sortOrder: number;
	createdAt: Date;
};

/** One address a project owns; an empty `localPart` owns the whole domain. */
export type ProjectAddressView = {
	id: string;
	domainId: string;
	hostname: string;
	localPart: string;
};

/** A project as the API returns it, with its addresses. */
export type ProjectView = ProjectRecord & { addresses: ProjectAddressView[] };

/** A domain the user may map to a project. */
export type ProjectDomainOption = {
	id: string;
	hostname: string;
};

/** A mapping on one domain: which project owns which local part ("" for the domain default). */
export type ProjectLocalPartMapping = {
	projectId: string;
	localPart: string;
};

/** A mapping across domains, as the client resolves sender options. */
export type ProjectHostMapping = ProjectLocalPartMapping & {
	hostname: string;
};

/** A requested address, before it is stored. */
export type ProjectAddressInput = {
	domainId: string;
	localPart: string;
};

/** A stored address with its owning project, for conflict checks. */
export type ProjectAddressRow = ProjectAddressInput & {
	projectId: string;
};

/** The fields that decide a message's own address. */
export type ProjectStampSource = {
	direction: "inbound" | "outbound" | string;
	deliveredTo: string | null;
	fromAddr: string;
	toAddr: string;
	ccAddr: string | null;
};

/** The project an address resolved to, with its name for webhooks. */
export type ResolvedProject = {
	id: string;
	name: string;
};

/** Outcome of one bounded re-stamp call; `cursor` continues it while `done` is false. */
export type ProjectRestampResult = {
	done: boolean;
	scanned: number;
	updated: number;
	cursor: string | null;
};
