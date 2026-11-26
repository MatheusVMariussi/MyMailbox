import type { ProjectAddressView, ProjectDomainOption } from "./types";

/** A project as the browser receives it from `/api/projects`. */
export type ProjectSummary = {
	id: string;
	name: string;
	color: string;
	sortOrder: number;
	addresses: ProjectAddressView[];
};

export type ProjectListResponse = {
	projects: ProjectSummary[];
	domains: ProjectDomainOption[];
};
