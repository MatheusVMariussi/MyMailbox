"use client";

import { SkipToContent } from "@/components/skip-to-content";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { SidebarAside, MobileMenuButton } from "@/components/sidebar-aside";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import clsx from "clsx";
import { CalendarLogoBlock } from "./calendar-logo-block";
import { CalendarMobileUpcoming } from "./calendar-mobile-upcoming";
import { RouteTitle } from "@/components/route-title";
import { Select } from "@/components/ui/select";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <AuthGuard requireFeature="calendar">
      <SidebarProvider mobileOverlay>
        <MailboxProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
                <RouteTitle />
              <div className="safe-area grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-[#f6f8fc]">
                <SkipToContent />
                <SidebarAside className="md:hidden"><CalendarMobileUpcoming /></SidebarAside>
                <div className="flex min-h-0 min-w-0 flex-col">
                  <header className="flex h-16 w-full shrink-0 items-center gap-3 pr-4 text-sm max-md:h-auto max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-2 max-md:pb-2 max-md:pr-2 max-md:pt-1">
                    <MobileMenuButton className="ml-1" />
                    <CalendarLogoBlock />
                    <div className="min-w-0 flex-1 basis-0 md:hidden"><div className="relative w-fit max-w-full"><Select aria-label={t("calendar.sectionLabel")} value={pathname === "/booking" ? "/booking" : "/calendar"} onChange={(event) => router.push(event.target.value)} containerClassName="contents" className="h-8 w-auto max-w-full rounded-full bg-white pl-3 pr-2 text-sm font-medium text-neutral-700"><option value="/booking">{t("calendar.bookings")}</option><option value="/calendar">{t("calendar.calendar")}</option></Select></div></div>
                    <div className="flex min-w-0 flex-1 items-center gap-3 md:overflow-x-auto max-md:contents">
                      <nav aria-label={t("calendar.sections")} className="flex shrink-0 max-md:hidden items-center rounded-full bg-white p-1">
                        <Link href="/booking" aria-current={pathname === "/booking" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/booking" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>{t("calendar.bookings")}</Link>
                        <Link href="/calendar" aria-current={pathname === "/calendar" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/calendar" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>{t("calendar.calendar")}</Link>
                      </nav>
                      <div id="calendar-header-slot" className="flex min-w-0 flex-1 items-center md:min-w-max max-md:order-last max-md:basis-full max-md:pl-3 max-md:empty:hidden" />
                    </div>
                    <MailboxSelector />
                  </header>
                  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <main id="main-content" tabIndex={-1} className="focus:outline-none min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f6f8fc] overscroll-contain scrollbar-gutter-stable">
                      <div key={pathname} className="page-transition-enter h-full min-h-0">{children}</div>
                    </main>
                  </div>
                </div>
                <FloatingComposer />
              </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
