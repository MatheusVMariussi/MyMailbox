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
							data-project-filter={project.id}
							className={cn("flex h-8 w-10 items-center justify-center rounded-lg transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none", projectId === project.id ? "bg-accent-soft" : "hover:bg-surface-2")}
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
					className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					aria-label={t("projects.manage")}
					title={t("projects.manage")}
				>
					<Settings className="h-4 w-4" />
				</Link>
			</NavSectionHeader>
			{open && projects.length === 0 && (
				<div className="ml-3 py-1.5 pl-3 text-xs text-ink-muted">
					<Link href="/settings/projects" className="hover:text-ink hover:underline">{t("projects.navEmpty")}</Link>
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
							"relative ml-3 flex h-8 w-[calc(100%-0.75rem)] items-center gap-3 rounded-lg pl-3 text-left text-sm text-ink-soft transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none max-md:min-h-11 max-md:text-base",
							active
								? "bg-accent-soft font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
								: "hover:bg-surface-2 hover:text-ink",
							unread > 0 && "font-semibold text-ink",
						)}
					>
						<span className="flex h-4 w-4 shrink-0 items-center justify-center">
							<ProjectDot name={project.name} color={project.color} className="h-2 w-2" />
						</span>
						<span className="min-w-0 flex-1 truncate">{project.name}</span>
						{unread > 0 && (
							<span className={cn("ml-auto mr-2 font-mono text-[11px] tabular-nums", active ? "text-ink" : "text-ink-soft")}>
								{unread > 99 ? "99+" : unread}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
