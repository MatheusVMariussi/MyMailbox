"use client";

import { Fragment, useId, useRef } from "react";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { SHORTCUT_CATALOG } from "./shortcut-catalog";
import type { ShortcutKeys } from "./shortcut-catalog-types";
import type { ShortcutDefinition } from "./types";

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The registered shortcuts; the dialog lists the full catalog, which covers them. */
  shortcuts?: ShortcutDefinition[];
}

const kbdClass = "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-ink-soft";

function Keys({ keys, then }: { keys: ShortcutKeys; then: string }) {
  const parts = keys.chord ?? keys.sequence;
  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 && (keys.sequence
            ? <span className="font-mono text-[10px] text-ink-muted">{then}</span>
            : <span aria-hidden="true" className="font-mono text-[10px] text-ink-muted">+</span>)}
          <kbd className={kbdClass}>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsHelpDialog({ isOpen, onClose }: ShortcutsHelpDialogProps) {
  if (!isOpen) return null;
  return <ShortcutsHelpDialogContent onClose={onClose} />;
}

function ShortcutsHelpDialogContent({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useDialogFocus(dialogRef, closeRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/65">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape" && event.key !== "?") return;
          event.stopPropagation();
          onClose();
        }}
        className="reader-enter relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[0_32px_96px_-32px_rgb(0_0_0/0.7)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <p aria-hidden="true" className="font-mono text-[12px] text-ink-muted">
              <span className="text-accent">~/</span>mymailbox <span className="text-ink-muted">$</span> help --keys
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-[-0.01em] text-ink">
              {t("shortcutsHelp.title")}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">{t("shortcutsHelp.subtitle")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("shortcutsHelp.close")}
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="gap-x-10 overflow-y-auto px-6 py-5 md:columns-2 lg:columns-3">
          {SHORTCUT_CATALOG.map((group) => (
            <section key={group.category} aria-labelledby={`${titleId}-${group.category}`} className="mb-6 break-inside-avoid last:mb-0">
              <h3 id={`${titleId}-${group.category}`} className="mb-2 font-mono text-[11px] text-ink-muted">
                <span aria-hidden="true">{"// "}</span>{t(`shortcut.category.${group.category}` as TranslationKey).toLocaleLowerCase()}
              </h3>
              <dl className="divide-y divide-line">
                {group.entries.map((entry) => (
                  <div key={entry.labelKey} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                    <dt className="min-w-0 text-ink-soft">{t(entry.labelKey)}</dt>
                    <dd className="flex shrink-0 items-center gap-1.5">
                      {entry.keys.map((keys, index) => (
                        <Fragment key={index}>
                          {index > 0 && <span className="text-[11px] text-ink-muted">{t("shortcutsHelp.or")}</span>}
                          <Keys keys={keys} then={t("shortcutsHelp.then")} />
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-surface-2 px-6 py-2.5 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">{renderWithKey(t("shortcutsHelp.pressToToggle", { key: "{key}" }), "?")}</span>
          <span className="inline-flex items-center gap-1.5">{renderWithKey(t("shortcutsHelp.pressToClose", { key: "{key}" }), "Esc")}</span>
        </div>
      </div>
    </div>
  );
}

// Puts a key badge where the translation has its {key} placeholder.
function renderWithKey(text: string, key: string) {
  const [before, after = ""] = text.split("{key}");
  return (
    <>
      {before}
      <kbd className={kbdClass}>{key}</kbd>
      {after}
    </>
  );
}
