"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import DomainsPage from "@/app/(admin)/domains/page";
import { SectionRowSkeleton } from "@/components/page-skeletons";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canManageDomains } from "@/lib/auth/admin";

/** Settings → Domains: the Admin domains page, for the same admins (the API enforces it too). */
export default function SettingsDomainsPage() {
	const router = useRouter();
	const user = useCurrentUser();
	const allowed = !!user && canManageDomains(user);

	useEffect(() => {
		if (user && !allowed) router.replace("/settings/account");
	}, [user, allowed, router]);

	if (!allowed) return <div className="py-4"><SectionRowSkeleton /></div>;
	return (
		<div className="py-4">
			<DomainsPage />
		</div>
	);
}
