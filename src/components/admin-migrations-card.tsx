"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleX, Database } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { applyDatabaseMigrations, getMigrationStatus } from "./admin-migrations-card-utils";
import type { MigrationStatusResponse } from "./admin-migrations-card-types";

/** Reports pending D1 migrations and lets the primary admin apply them after a deploy. */
export function AdminMigrationsCard() {
	const { t } = useLanguage();
	const [status, setStatus] = useState<MigrationStatusResponse>();
	const [error, setError] = useState("");
	const [isChecking, setIsChecking] = useState(true);
	const [isMigrating, setIsMigrating] = useState(false);

	useEffect(() => {
		let isActive = true;
		getMigrationStatus()
			.then((databaseStatus) => {
				if (isActive) setStatus(databaseStatus);
			})
			.catch((statusError) => {
				if (isActive) setError(statusError instanceof Error ? statusError.message : t("migrations.checkFailed"));
			})
			.finally(() => {
				if (isActive) setIsChecking(false);
			});
		return () => {
			isActive = false;
		};
	}, [t]);

	async function handleMigrate() {
		setError("");
		setIsMigrating(true);
		try {
			setStatus(await applyDatabaseMigrations());
		} catch (migrationFailure) {
			setError(migrationFailure instanceof Error ? migrationFailure.message : t("migrations.applyFailed"));
		} finally {
			setIsMigrating(false);
		}
	}

	const hasUnknown = !!status?.unknown.length;
	const pendingCount = status?.pending.length ?? 0;

	return (
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="flex-row items-center gap-4 space-y-0 py-0">
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
					<Database className="h-5 w-5" />
				</div>
				<div>
					<CardTitle className="text-base">{t("migrations.title")}</CardTitle>
					<p className="mt-1 text-sm text-neutral-500">{t("migrations.description")}</p>
				</div>
			</CardHeader>
			<CardContent className="space-y-5 pt-5">
				<div className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-100">
					{isChecking && (
						<div className="flex items-center gap-3 px-4 py-4">
							<Skeleton className="h-4 w-4 rounded-full" />
							<Skeleton className="h-4 w-44" />
						</div>
					)}

					{!isChecking && pendingCount > 0 && !hasUnknown && (
						<div className="flex items-center gap-3 px-4 py-4">
							<Database className={`h-4 w-4 shrink-0 text-amber-600 ${isMigrating ? "animate-pulse" : ""}`} />
							<p className="text-sm text-neutral-700">{t("migrations.pending", { count: pendingCount })}</p>
							<button
								type="button"
								onClick={handleMigrate}
								disabled={isMigrating}
								className="ml-auto shrink-0 text-sm font-medium text-blue-700 hover:underline disabled:pointer-events-none disabled:opacity-50"
							>
								{isMigrating ? t("migrations.applying") : t("migrations.apply")}
							</button>
						</div>
					)}

					{!isChecking && hasUnknown && (
						<div className="flex items-center gap-3 px-4 py-4 text-sm text-red-600">
							<CircleX className="h-4 w-4 shrink-0" />
							{t("migrations.deployMatching")}
						</div>
					)}

					{!isChecking && status?.ready && (
						<div className="flex items-center gap-3 px-4 py-4">
							<CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
							<p className="text-sm text-neutral-700">{t("migrations.upToDate")}</p>
						</div>
					)}
				</div>
				{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
			</CardContent>
		</Card>
	);
}
