import Link from "next/link";
import type { DragEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { getMessageDragData } from "@/lib/messages/drag-utils";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useConversationView } from "@/components/messages/use-conversation-view";
import { useListScope } from "./list-scope-provider";
import { useSidebar } from "./sidebar-state";
import { useCompose } from "./compose/compose-context";
import { Tooltip } from "./ui/tooltip";
import { FULL_ROUTE_PREFETCH } from "@/lib/navigation/prefetch";
import { preloadMailboxPage } from "./components-nav-utils";
import type { NavLink } from "./components-nav-types";

type Props = {
  link: NavLink,
  iconClassName?: string,
  labelClassName?: string,
  wrap?: boolean
}
export function NavItem({ link, iconClassName, labelClassName, wrap }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { openComposer } = useCompose();
  const scope = useListScope();
  const { minimal } = useSidebar();
  const { query } = useMailSearch();
  const [conversationView] = useConversationView();
  const [dragOver, setDragOver] = useState(false);
  const prefetchedKey = useRef<string | null>(null);

  if (!link.href) {
    return <span className="flex-1" />;
  }

  const Icon = link.icon;
  if (!Icon) return null;
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  const classes = cn(
    "relative flex h-8 items-center gap-3 rounded-lg text-sm text-ink-soft transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none max-md:min-h-11 max-md:text-base",
    minimal && "mx-auto w-10 justify-center px-0",
    active
      ? "bg-accent-soft font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
      : "hover:bg-surface-2 hover:text-ink",
    dragOver && "bg-accent-soft text-ink ring-1 ring-accent/40",
    link.primary &&
    "mb-4 h-11 w-fit gap-2.5 rounded-full bg-blue-600 px-5 font-medium text-white before:hidden hover:bg-blue-700 hover:text-white hover:shadow-[0_0_24px_-4px_rgba(79,140,255,0.6)] focus-visible:shadow-[0_0_24px_-4px_rgba(79,140,255,0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
    link.count && !link.primary && "font-semibold text-ink",
    link.primary && minimal && "h-11 w-11 rounded-full px-0",
    wrap && !minimal && "h-auto min-h-8 items-start py-1.5",
  );
  // Inactive icons stay quiet; the active one takes the accent. Label colours (iconColor) always win.
  const iconTone = link.primary ? "text-white" : active ? "text-accent" : "text-ink-muted";
  const countClass = cn("ml-auto mr-2 font-mono text-[11px] tabular-nums", active ? "text-ink" : "text-ink-soft", wrap && "shrink-0 leading-5");
  const railBadgeClass = "absolute -right-1 -top-1 min-w-4 rounded-full bg-blue-600 px-1 text-center font-mono text-[10px] font-medium leading-4 text-white";
  const dropProps = link.onMessageDrop
    ? {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (event: DragEvent) => {
        const payload = getMessageDragData(event.dataTransfer);
        setDragOver(false);
        if (!payload) return;
        event.preventDefault();
        link.onMessageDrop?.(payload.messageIds);
      },
    }
    : {};

  if (link.href === "/compose") {
    const composeButton = (
      <button
        type="button"
        onClick={() => openComposer()}
        className={cn(!minimal && "ml-3", classes)}
        aria-label={minimal ? link.label : undefined}
        {...dropProps}
      >
        <Icon
          size={18}
          style={{ color: link.iconColor }}
          className={cn(iconTone, iconClassName)}
          strokeWidth={2}
        />
        {!minimal && <span className="flex-1">{link.label}</span>}
      </button>
    );
    return minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{composeButton}</Tooltip> : composeButton;
  }

  function prefetch() {
    if (!link.preloadMessages || active || !link.href) return;
    const key = [link.href, scope.mailboxId ?? "", scope.projectId ?? "", query, conversationView].join("\u0000");
    if (prefetchedKey.current === key) return;
    prefetchedKey.current = key;
    router.prefetch(link.href, FULL_ROUTE_PREFETCH);
    void preloadMailboxPage(link.href, scope.mailboxId ?? undefined, { query, grouped: conversationView, projectId: scope.projectId })
      .catch(() => { prefetchedKey.current = null; });
  }

  const navLink = (
    <Link
      href={link.href}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      aria-current={active ? "page" : undefined}
      aria-label={minimal ? (typeof link.count === "number" && link.count > 0 ? `${link.label}, ${link.count}` : link.label) : undefined}
      className={cn(!minimal && "ml-3 pl-3", classes)}
      {...dropProps}
    >
      <Icon
        style={{ color: link.iconColor }}
        size={16}
        strokeWidth={2}
        className={cn("max-md:h-5 max-md:w-5", !link.iconColor && iconTone, wrap && !minimal && "mt-0.5 shrink-0", iconClassName)}
      />
      {!minimal && <span className={cn("flex-1", wrap && "min-w-0 break-words leading-5 max-md:leading-6", labelClassName)}>{link.label}</span>}
      {!minimal && typeof link.count === "number" && link.count > 0 && (
        <span className={countClass}>
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
      {minimal && typeof link.count === "number" && link.count > 0 && (
        <span className={railBadgeClass}>
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
    </Link>
  );

  return (
    <>
      {minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{navLink}</Tooltip> : navLink}
    </>
  );
}
