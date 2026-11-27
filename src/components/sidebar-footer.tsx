"use client";

import { useSidebar } from "./sidebar-state";
import { useShortcuts } from "./shortcuts";
import { Keyboard } from "@/components/icons";
import { useLanguage } from "./language-provider";
import { Credits } from "./credits";

export function SidebarFooter() {
	const { t } = useLanguage();
	const { minimal } = useSidebar();
	const { openHelpModal, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	if (minimal) return null;

  return (
    <div className="px-3 pt-3 flex flex-col gap-2">
      {shortcutsEnabled && !shortcutsPreferenceLoading && (
        <button
          type="button"
          onClick={openHelpModal}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors duration-150 ease-out-soft hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
          <span className="flex items-center gap-1.5">
            <Keyboard className="h-3.5 w-3.5" />
            {t("navigation.shortcuts")}
          </span>
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-ink-soft">
            ?
          </kbd>
        </button>
      )}
      <Credits />
    </div>
  );
}
