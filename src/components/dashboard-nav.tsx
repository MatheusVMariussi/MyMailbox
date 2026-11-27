"use client";

import { useLanguage } from "./language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  Archive,
  BellOff,
  CalendarClock,
  Clock,
  FileText,
  Inbox,
  MailPlus,
  MoreVertical,
  Plus,
  Send,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
} from "@/components/icons";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { hasActivePromotions } from "@/lib/promotions/ui-utils";
import { NavItem } from "./components-nav";
import type { NavLink } from "./components-nav-types";
import type { NavLabel } from "./dashboard-nav-types";
import {
  getFolderNavCount,
  moveMessagesToLabel,
  moveMessagesToSystemFolder,
} from "./dashboard-nav-utils";
import { LabelDialog } from "./labels/label-dialog";
import { useListScope } from "./list-scope-provider";
import { useScopeLabels } from "./messages/use-scope-labels";
import { ProjectsNav } from "./projects/projects-nav";
import { sumLabelCounts } from "@/lib/labels/group-utils";
import { NavSectionHeader, useSectionOpen } from "./nav-section-header";
import { ReorderableList } from "./reorderable-list";
import { readStorage, writeStorage } from "./reorderable-list-utils";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarScaffold } from "./sidebar-scaffold";
import { useSidebar } from "./sidebar-state";

const links = [
  { href: "/compose", labelKey: "navigation.compose", icon: MailPlus, primary: true },
  { href: "/inbox", labelKey: "navigation.inbox", icon: Inbox, preloadMessages: true },
  { href: "/promotions", labelKey: "navigation.promotions", icon: Tag, preloadMessages: true },
  { href: "/starred", labelKey: "navigation.starred", icon: Star, preloadMessages: true },
  { href: "/snoozed", labelKey: "navigation.snoozed", icon: Clock, preloadMessages: true },
  { href: "/sent", labelKey: "navigation.sent", icon: Send, preloadMessages: true },
  { href: "/scheduled", labelKey: "navigation.scheduled", icon: CalendarClock, preloadMessages: true },
  { href: "/drafts", labelKey: "navigation.drafts", icon: FileText, preloadMessages: true },
  {
    href: "/archived",
    labelKey: "navigation.archived",
    icon: Archive,
    preloadMessages: true,
  },
  { href: "/spam", labelKey: "navigation.spam", icon: ShieldAlert, preloadMessages: true },
  { href: "/trash", labelKey: "navigation.trash", icon: Trash2, preloadMessages: true },
  { href: "/subscriptions", labelKey: "navigation.subscriptions", icon: BellOff },
] satisfies (Omit<NavLink, "label"> & { labelKey: TranslationKey })[];


// Drafts, Archived, Spam, Trash and Subscriptions start tucked under "More...".
const MORE_LINK_HREFS = ["/drafts", "/archived", "/spam", "/trash", "/subscriptions"];
const MAX_VISIBLE_LABELS = 3;
const MORE_OPEN_KEY = "mymailbox:nav:more-open";
const LABELS_OPEN_KEY = "mymailbox:nav:labels-open";

const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

function NavToggle({ expanded, onClick, collapsedLabel, expandedLabel }: { expanded: boolean; onClick: () => void; collapsedLabel?: string; expandedLabel?: string }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="ml-3 flex h-8 w-[calc(100%-0.75rem)] items-center rounded-lg pl-10 text-left text-sm text-ink-muted transition-colors duration-150 ease-out-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none max-md:min-h-11 max-md:pl-11 max-md:text-base"
    >
      {expanded ? (expandedLabel ?? t("navigation.less")) : (collapsedLabel ?? t("navigation.more"))}
    </button>
  );
}

export function DashboardNav({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { minimal, mobile } = useSidebar();
  const pathname = usePathname();
  // Storage is read after hydration so the server and first client render agree.
  const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);
  const [moreOpenChoice, setMoreOpen] = useState<boolean | null>(null);
  const [labelsOpenChoice, setLabelsOpen] = useState<boolean | null>(null);
  const moreOpen = moreOpenChoice ?? (hydrated && readStorage(MORE_OPEN_KEY, false));
  const labelsOpen = labelsOpenChoice ?? (hydrated && readStorage(LABELS_OPEN_KEY, false));
  const [labelsSectionOpen, toggleLabelsSection] = useSectionOpen("mymailbox:nav:labels-section-open");
  const { selectedMailbox } = useSelectedMailbox();
  // Counts and labels follow the list scope (every mailbox by default); new labels go to the scoped mailbox,
  // or to the selected one in the unified view.
  const scope = useListScope();
  const { counts } = useMessageCounts(scope.mailboxId, !scope.isLoading, scope.projectId);
  const { groups: labels } = useScopeLabels();
  const labelMailboxId = scope.mailboxId ?? selectedMailbox?.id;
  // The dialog is keyed by what it edits, so opening it again starts from that label's current values.
  const [dialog, setDialog] = useState<{ key: number; label: NavLabel | null } | null>(null);
  const promotionsOn = hasActivePromotions(counts.promotionModes);
  const linksWithCounts: NavLink[] = links.filter((link) => (link.href !== "/scheduled" || counts.folders.scheduled.total > 0) && (link.href !== "/promotions" || promotionsOn) && (link.href !== "/subscriptions" || promotionsOn)).map(({ labelKey, ...rest }): NavLink => {
    const link = { ...rest, label: t(labelKey) };
    if (link.href === "/inbox") {
      return { ...link, count: getFolderNavCount("inbox", counts.folders) };
    }
    if (link.href === "/promotions") {
      return { ...link, count: getFolderNavCount("promotions", counts.folders) };
    }
    if (link.href === "/starred") {
      return { ...link, count: getFolderNavCount("starred", counts.folders) };
    }
    if (link.href === "/snoozed") {
      return { ...link, count: getFolderNavCount("snoozed", counts.folders) };
    }
    if (link.href === "/sent") {
      return { ...link, count: getFolderNavCount("sent", counts.folders) };
    }
    if (link.href === "/scheduled") {
      return { ...link, count: counts.folders.scheduled.total };
    }
    if (link.href === "/drafts") {
      return { ...link, count: getFolderNavCount("drafts", counts.folders) };
    }
    if (link.href === "/archived") {
      return {
        ...link,
        count: getFolderNavCount("archived", counts.folders),
        onMessageDrop: (messageIds: string[]) =>
          void moveMessagesToSystemFolder(messageIds, "archive"),
      };
    }
    if (link.href === "/spam") {
      return {
        ...link,
        count: getFolderNavCount("spam", counts.folders),
        onMessageDrop: (messageIds: string[]) =>
          void moveMessagesToSystemFolder(messageIds, "spam"),
      };
    }
    if (link.href === "/trash") {
      return {
        ...link,
        count: getFolderNavCount("trash", counts.folders),
        onMessageDrop: (messageIds: string[]) =>
          void moveMessagesToSystemFolder(messageIds, "trash"),
      };
    }
    return link;
  });

  function toggleMore() {
    writeStorage(MORE_OPEN_KEY, !moreOpen);
    setMoreOpen(!moreOpen);
  }

  function toggleLabels() {
    writeStorage(LABELS_OPEN_KEY, !labelsOpen);
    setLabelsOpen(!labelsOpen);
  }

  const isActiveHref = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const composeLink = linksWithCounts.find((link) => link.href === "/compose");
  const mainLinks = linksWithCounts.filter((link) => link.href !== "/compose" && !MORE_LINK_HREFS.includes(link.href!));
  const moreLinks = linksWithCounts.filter((link) => MORE_LINK_HREFS.includes(link.href!));
  // The icon rail has no room for text toggles. When collapsed, the page you are on stays listed on its own.
  const showAllMoreLinks = minimal || moreOpen;
  const labelsOverflow = !minimal && labels.length > MAX_VISIBLE_LABELS;

  return (
    <SidebarScaffold className={className} header={<SidebarHeader href="/inbox" />} footer={<SidebarFooter />}>
      {composeLink && !mobile && <NavItem labelClassName="font-medium" link={composeLink} />}
      {minimal && <hr className="mx-6 my-2 border-line" />}
      <ReorderableList
        storageKey="mymailbox:nav:layout"
        enabled={!minimal}
        lists={[
          { id: "main", items: mainLinks.map((link) => ({ id: link.href!, node: <NavItem link={link} /> })) },
          {
            id: "more",
            before: minimal ? undefined : <NavToggle expanded={moreOpen} onClick={toggleMore} />,
            visibleIds: (ordered) => showAllMoreLinks ? ordered : ordered.filter((id) => isActiveHref(id)),
            items: moreLinks.map((link) => ({ id: link.href!, node: <NavItem link={link} /> })),
          },
        ]}
      />
      {minimal && <hr className="mx-6 my-2 border-line" />}
      <ProjectsNav counts={counts} minimal={minimal} />
      {!minimal && (
        <NavSectionHeader label={t("navigation.labels")} open={labelsSectionOpen} onToggle={toggleLabelsSection}>
          {labelMailboxId && (
            <button
              type="button"
              onClick={() => setDialog({ key: Date.now(), label: null })}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("labels.create")}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </NavSectionHeader>
      )}
      {labelMailboxId && dialog && (
        <LabelDialog
          key={dialog.key}
          open
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          mailboxId={dialog.label?.mailboxId ?? labelMailboxId}
          label={dialog.label}
        />
      )}
      {!minimal && labelsSectionOpen && labels.length === 0 && (
        <div className="ml-3 py-1.5 pl-3 text-xs text-ink-muted">
          {t("navigation.noLabels")}
        </div>
      )}
      {(minimal || labelsSectionOpen) && <ReorderableList
        storageKey="mymailbox:nav:layout:labels"
        enabled={!minimal}
        lists={[{
          id: "labels",
          visibleIds: (ordered) => {
            if (!labelsOverflow || labelsOpen) return ordered;
            const first = ordered.slice(0, MAX_VISIBLE_LABELS);
            const active = ordered.slice(MAX_VISIBLE_LABELS).find((id) => isActiveHref(`/labels/${id}`));
            return active ? [...first, active] : first;
          },
          // In the unified view same-named labels of different mailboxes are one entry (`filter` joins their ids).
          items: labels.map((label) => ({
            id: label.filter,
            node: (
              <div className="group/label relative" data-label-id={label.filter}>
                <NavItem
                  wrap
                  link={{
                    href: `/labels/${label.filter}`,
                    label: label.name,
                    icon: Tag,
                    preloadMessages: true,
                    iconColor: label.color,
                    count: sumLabelCounts(label.filter, counts.labels)?.unread,
                    // Dropping mail on a label is "Move to": the label (each mailbox's of that name), and out of the inbox.
                    onMessageDrop: (messageIds: string[]) =>
                      void moveMessagesToLabel(messageIds, label.id),
                  }}
                />
                {/* A grouped label spans mailboxes; it is edited per mailbox, from that mailbox's own view. */}
                {!minimal && label.ids.length === 1 && (
                  <button
                    type="button"
                    onClick={() => setDialog({ key: Date.now(), label: { id: label.id, mailboxId: label.mailboxId, name: label.name, color: label.color } })}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-surface-3 text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover/label:opacity-100 max-md:top-2.5 max-md:opacity-100"
                    aria-label={t("labels.options", { name: label.name })}
                    title={t("labels.edit")}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ),
          })),
        }]}
      />}
      {labelsSectionOpen && labelsOverflow && <NavToggle expanded={labelsOpen} onClick={toggleLabels} />}
    </SidebarScaffold>
  );
}
