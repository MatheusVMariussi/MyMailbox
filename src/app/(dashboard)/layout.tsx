"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { ListScopeProvider } from "@/components/list-scope-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { DnsSkippedBanner } from "@/components/dns-skipped-banner";
import { DashboardNav } from "@/components/dashboard-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import { SidebarAside, MobileMenuButton } from "@/components/sidebar-aside";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { ShortcutsProvider } from "@/components/shortcuts";
import clsx from "clsx";
import { usePathname } from "next/navigation";
import { RouteTitle } from "@/components/route-title";
import { useAppBadge } from "@/hooks/use-app-badge";
import { UndoToasts } from "@/components/messages/undo-toasts";
import { Toaster } from "react-hot-toast";
import { PromotionToast } from "@/components/messages/promotion-toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Contacts is a list page like Mailboxes: gray page, white rows, no white panel.
  const listPage = pathname === "/contacts" || pathname.startsWith("/contacts/");
  useAppBadge();

  return (
    <AuthGuard>
      <SidebarProvider mobileOverlay>
        <MailboxProvider>
          <ListScopeProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
                <RouteTitle />
                <div className="safe-area grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-ground transition-[grid-template-columns] ease-out-soft motion-reduce:transition-none md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]" style={{ transitionDuration: "var(--sidebar-transition-duration)" }}>
                  <SkipToContent />
                  <SidebarAside>
                    <div className="h-full">
                      <DashboardNav />
                    </div>
                    <SidebarResizeBoundary />
                  </SidebarAside>
                  <div className="flex min-h-0 min-w-0 flex-col">
                    <header className="flex h-16 w-full shrink-0 items-center gap-3 pr-3 text-sm md:pr-4">
                      <MobileMenuButton className="ml-2" />
                      {/* The search stays centred in the free width between the sidebar and the account menu. */}
                      <div className="flex min-w-0 flex-1 items-center md:justify-center">
                        <div className="flex min-w-0 flex-1 items-center md:max-w-[760px]">
                          <MailSearchInput mobileEnd />
                        </div>
                      </div>
                      <MailboxSelector />
                    </header>
                    <DnsSkippedBanner />
                    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                      <main id="main-content" tabIndex={-1} className={clsx("focus:outline-none page-flush min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable", listPage ? "rounded-tl-2xl max-md:rounded-t-2xl max-md:bg-white max-md:pb-24" : "rounded-t-2xl bg-white md:mr-2 md:border md:border-b-0 md:border-line max-md:border-t max-md:border-line")}>
                        {children}
                      </main>
                    </div>
                  </div>
                  <FloatingComposer showButton />
                  <UndoToasts />
                  <Toaster position="bottom-left" containerClassName="text-sm" />
                  <PromotionToast />
                </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
          </ListScopeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
