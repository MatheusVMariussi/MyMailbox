import { PageHeading } from "@/components/page-heading";
import { ProjectsSettings } from "@/components/settings/projects-settings";

export default function SettingsProjectsPage() {
	return (
		<div className="space-y-6 py-4">
			<PageHeading labelKey="settings.nav.projects" />
			<ProjectsSettings />
		</div>
	);
}
