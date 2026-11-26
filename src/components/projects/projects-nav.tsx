"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useListScope } from "@/components/list-scope-provider";
import { NavSectionHeader, useSectionOpen } from "@/components/nav-section-header";
import { Tooltip } from "@/components/ui/tooltip";
import type { MessageCounts } from "@/hooks/types";
import { cn } from "@/lib/utils";
import { ProjectDot } from "./project-dot";
import { listRootFor } from "./projects-nav-utils";
import { useProjects } from "./use-projects";

type Props = {
	counts: MessageCounts;
	minimal: boolean;
};

/**
 * The sidebar's "Projects" section: one entry per project with its color and unread Inbox count. Choosing one
 * filters every list to that project (choosing it again shows every project); the folder stays the same.
 */
export function ProjectsNav({ counts, minimal }: Props) {
	const { t } = useLanguage();
	const pathname = usePathname();
	const router = useRouter();
	const { projects } = useProjects();
	const { projectId, setProjectFilter } = useListScope();
	const [open, toggle] = useSectionOpen("mymailbox:nav:projects-section-open");

	function choose(id: string) {
		const next = projectId === id ? null : id;
		setProjectFilter(next);
		const root = listRootFor(pathname);
		if (root !== pathname) router.push(root);
	}

	if (minimal) {
		if (projects.length === 0) return null;
		return (
			<div className="flex flex-col items-center gap-1 py-1" data-projects-nav="">
				{projects.map((project) => (
					<Tooltip key={project.id} label={project.name} placement="right">
						<button
							type="button"
							onClick={() => choose(project.id)}
							aria-pressed={projectId === project.id}
							aria-label={project.name}
							className={cn("flex h-9 w-10 items-center justify-center rounded-full transition-colors", projectId === project.id ? "bg-blue-100" : "hover:bg-neutral-200/60")}
						>
							<ProjectDot name={project.name} color={project.color} className="h-2.5 w-2.5" />
						</button>
					</Tooltip>
				))}
			</div>
		);
	}

	return (
		<div data-projects-nav="">
			<NavSectionHeader label={t("projects.title")} open={open} onToggle={toggle}>
				<Link
					href="/settings/projects"
					className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-blue-50 hover:text-blue-700"
					aria-label={t("projects.manage")}
					title={t("projects.manage")}
				>
					<Settings className="h-4 w-4" />
				</Link>
			</NavSectionHeader>
			{open && projects.length === 0 && (
				<div className="px-4 py-1.5 text-xs text-neutral-500">
					<Link href="/settings/projects" className="hover:underline">{t("projects.navEmpty")}</Link>
				</div>
			)}
			{open && projects.map((project) => {
				const active = projectId === project.id;
				const unread = counts.projects?.[project.id]?.unread ?? 0;
				return (
					<button
						key={project.id}
						type="button"
						onClick={() => choose(project.id)}
						aria-pressed={active}
						title={active ? t("projects.showAll") : t("projects.filterBy", { name: project.name })}
						data-project-filter={project.id}
						className={cn(
							"flex h-9 w-full items-center gap-3 rounded-r-full pl-6 text-left text-sm text-neutral-700 transition-colors max-md:min-h-11 max-md:text-base",
							active ? "bg-blue-100 font-semibold text-blue-900" : "hover:bg-neutral-200/60",
							unread > 0 && "font-semibold",
						)}
					>
						<span className="flex h-4 w-4 shrink-0 items-center justify-center">
							<ProjectDot name={project.name} color={project.color} className="h-2.5 w-2.5" />
						</span>
						<span className="min-w-0 flex-1 truncate">{project.name}</span>
						{unread > 0 && (
							<span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-neutral-700">
								{unread > 99 ? "99+" : unread}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
