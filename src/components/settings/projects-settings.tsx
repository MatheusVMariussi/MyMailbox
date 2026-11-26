"use client";

import { useState, type FormEvent } from "react";
import { useLanguage } from "@/components/language-provider";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectColorPicker } from "@/components/projects/project-color-picker";
import { useProjects } from "@/components/projects/use-projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { createProjectRequest, invalidateProjectsCache } from "@/lib/projects/client";
import { DEFAULT_PROJECT_COLOR, PROJECT_COLOR_VALUES } from "@/lib/projects/colors";
import { PROJECT_NAME_MAX } from "@/lib/projects/project-utils";

/** Settings → Projects: create projects, then map each to the domains and addresses it owns. */
export function ProjectsSettings() {
	const { t } = useLanguage();
	const { projects, domains, isLoading } = useProjects();
	const [name, setName] = useState("");
	// Each new project starts on the next unused color of the palette.
	const nextColor = PROJECT_COLOR_VALUES.find((value) => !projects.some((project) => project.color === value)) ?? DEFAULT_PROJECT_COLOR;
	const [color, setColor] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function create(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!name.trim()) return;
		setPending(true);
		setError(null);
		try {
			await createProjectRequest({ name, color: color ?? nextColor });
			setName("");
			setColor(null);
			invalidateProjectsCache();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("projects.error"));
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="space-y-6">
			<p className="text-sm text-neutral-500">{t("projects.description")}</p>
			<form onSubmit={create} className="space-y-4 rounded-3xl bg-white p-6" data-project-create="">
				<h2 className="text-base font-semibold text-neutral-900">{t("projects.create")}</h2>
				<div className="space-y-2">
					<Label htmlFor="new-project-name">{t("projects.name")}</Label>
					<Input id="new-project-name" value={name} maxLength={PROJECT_NAME_MAX} placeholder={t("projects.example")} onChange={(event) => setName(event.target.value)} />
				</div>
				<div className="space-y-2">
					<Label>{t("projects.color")}</Label>
					<ProjectColorPicker value={color ?? nextColor} onChange={setColor} disabled={pending} />
				</div>
				{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
				<Button type="submit" disabled={pending || !name.trim()}>{pending ? t("projects.creating") : t("projects.create")}</Button>
			</form>
			{isLoading && <Skeleton className="h-40 w-full rounded-3xl" />}
			{!isLoading && projects.length === 0 && <p className="text-sm text-neutral-500">{t("projects.empty")}</p>}
			{projects.map((project) => <ProjectCard key={`${project.id}:${project.name}:${project.color}:${project.addresses.length}`} project={project} domains={domains} />)}
		</div>
	);
}
