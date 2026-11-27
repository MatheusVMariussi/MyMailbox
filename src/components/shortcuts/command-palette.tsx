"use client";

import React, { useId, useState, useEffect, useRef, useMemo } from "react";
import { CornerDownLeft } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { CommandItem } from "./types";
import type { TranslationKey } from "@/lib/i18n/types";
import { filterCommands, groupCommandsByCategory } from "./command-palette-utils";
import { CommandPaletteItem } from "./command-palette-item";
import { useDialogFocus } from "@/components/use-dialog-focus";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

function CommandPaletteDialog({
  onClose,
  commands,
}: {
  onClose: () => void;
  commands: CommandItem[];
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useDialogFocus(dialogRef, inputRef);

  const filteredCommands = useMemo(
    () => filterCommands(commands, query),
    [commands, query]
  );

  const activeIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredCommands.length - 1)
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1)
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[activeIndex]) {
        filteredCommands[activeIndex].perform();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const grouped = useMemo(
    () => groupCommandsByCategory(filteredCommands),
    [filteredCommands]
  );

  let flatIndex = 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] dark:bg-black/65">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.placeholder")}
        className="reader-enter relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[0_32px_96px_-32px_rgb(0_0_0/0.7)]"
        onKeyDown={handleKeyDown}
      >
        {/* A terminal prompt: `>` then the command you are typing. */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span aria-hidden="true" className="font-mono text-[15px] font-medium text-accent">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("palette.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={filteredCommands.length ? optionId(activeIndex) : undefined}
            aria-label={t("palette.placeholder")}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full bg-transparent font-mono text-[14px] text-ink caret-accent placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-ink-soft">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div id={listboxId} role="listbox" aria-label={t("palette.placeholder")} className="max-h-80 overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div role="status" className="px-4 py-8 font-mono text-[13px] text-ink-muted">
              {t("palette.noMatch", { query })}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} role="group" aria-label={t(`shortcut.category.${category}` as TranslationKey)} className="mb-2 last:mb-0">
                <div aria-hidden="true" className="px-3 pb-1 pt-1.5 font-mono text-[11px] text-ink-muted">
                  {"// "}{t(`shortcut.category.${category}` as TranslationKey).toLocaleLowerCase()}
                </div>
                {items.map((item) => {
                  const isCurrent = flatIndex === activeIndex;
                  const itemIndex = flatIndex;
                  flatIndex++;

                  return (
                    <CommandPaletteItem
                      key={item.id}
                      id={optionId(itemIndex)}
                      item={item}
                      isActive={isCurrent}
                      onSelect={() => {
                        item.perform();
                        onClose();
                      }}
                      onHover={() => setSelectedIndex(itemIndex)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-2 text-xs text-ink-muted">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-1 px-1 font-mono text-[11px] text-ink-soft">↑↓</kbd>
              {t("palette.navigate")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-1 px-1 text-ink-soft"><CornerDownLeft className="h-3 w-3" /></kbd>
              {t("palette.select")}
            </span>
          </div>
          <span className="font-mono text-[11px]">{t("palette.actions")}</span>
        </div>
      </div>
    </div>
  );
}

export function CommandPalette({
  isOpen,
  onClose,
  commands,
}: CommandPaletteProps) {
  if (!isOpen) return null;
  return <CommandPaletteDialog onClose={onClose} commands={commands} />;
}
