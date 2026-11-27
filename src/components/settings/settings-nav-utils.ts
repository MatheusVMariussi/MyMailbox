import { canManageDomains } from "@/lib/auth/admin";
import type { SettingsNavSection } from "./settings-nav-types";

export const settingsNavSections: SettingsNavSection[] = [
	{
		labelKey: "settings.nav.settings",
		items: [
			{
				href: "/settings/account",
				labelKey: "settings.nav.account",
			},
			{
				href: "/settings/inbox",
				labelKey: "settings.nav.inbox",
			},
			{
				href: "/settings/security",
				labelKey: "settings.nav.security",
			},
			{
				href: "/settings/api-keys",
				labelKey: "settings.nav.apiKeys",
			},
			{
				href: "/settings/app-passwords",
				labelKey: "settings.nav.appPasswords",
			},
			{
				href: "/settings/projects",
				labelKey: "settings.nav.projects",
			},
			{
				href: "/settings/rules",
				labelKey: "settings.nav.rules",
			},
		],
	},
	{
		labelKey: "settings.nav.mailbox",
		items: [
			{
				href: "/settings/mailboxes",
				labelKey: "admin.nav.mailboxes",
				requiresMailboxAccess: true,
			},
			{
				href: "/settings/domains",
				labelKey: "settings.nav.domains",
				requiresDomainAccess: true,
			},
			{
				href: "/settings/export",
				labelKey: "settings.nav.export",
			},
		],
	},
];

type NavUser = { role: "admin" | "user"; isPrimaryAdmin: boolean; canManageDomains: boolean; canManageMailboxes: boolean };

/** The sections with the entries this user may open; permission-gated entries stay hidden until the user loads. */
export function visibleSettingsNavSections(user: NavUser | null | undefined): SettingsNavSection[] {
	return settingsNavSections.map((section) => ({
		...section,
		items: section.items.filter((item) => (
			(!item.requiresMailboxAccess || user?.canManageMailboxes === true)
			&& (!item.requiresDomainAccess || (!!user && canManageDomains(user)))
		)),
	}));
}

export function isActiveSettingsPath(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}
