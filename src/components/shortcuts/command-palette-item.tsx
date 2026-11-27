"use client";

import React from "react";
import type { CommandItem } from "./types";

interface CommandPaletteItemProps {
  id: string;
  item: CommandItem;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function CommandPaletteItem({
  id,
  item,
  isActive,
  onSelect,
  onHover,
}: CommandPaletteItemProps) {
  const Icon = item.icon;

  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors duration-100 ${
        isActive
          ? "bg-accent-soft text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
          : "text-ink-soft hover:bg-surface-2"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <Icon
            className={`h-4 w-4 shrink-0 ${isActive ? "text-accent" : "text-ink-muted"}`}
          />
        )}
        <div className="truncate">
          <span className="text-sm font-medium">{item.title}</span>
          {item.subtitle && (
            <span className="ml-2 truncate text-xs text-ink-muted">
              {item.subtitle}
            </span>
          )}
        </div>
      </div>
      {item.shortcut && (
        <kbd className="inline-flex h-5 shrink-0 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-ink-soft">
          {item.shortcut}
        </kbd>
      )}
    </button>
  );
}
