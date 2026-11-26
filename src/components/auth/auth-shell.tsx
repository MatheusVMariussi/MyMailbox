"use client";

import { useState } from "react";
import { useBranding } from "@/components/branding-provider";
import { LanguageSelector } from "@/components/language-selector";
import type { AuthShellProps } from "./types";

export function AuthShell({
  icon: Icon,
  title,
  description,
  children,
  footer,
  steps,
}: AuthShellProps) {
  const branding = useBranding();
  const [iconUrl, setIconUrl] = useState(branding.iconUrl);
  const [iconFailed, setIconFailed] = useState(false);
  const [brandingIconUrl, setBrandingIconUrl] = useState(branding.iconUrl);

  // Start over with the new icon whenever the branding icon changes.
  if (brandingIconUrl !== branding.iconUrl) {
    setBrandingIconUrl(branding.iconUrl);
    setIconUrl(branding.iconUrl);
    setIconFailed(false);
  }

  return (
    <div className="atmosphere min-h-dvh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-ink sm:px-6 sm:py-6 lg:flex lg:items-center lg:px-10 lg:py-10">
      <main className="mx-auto grid min-h-dvh w-full max-w-4xl grid-rows-[auto_1fr] overflow-hidden bg-surface-1 sm:min-h-0 sm:grid-rows-none sm:rounded-3xl sm:border sm:border-line sm:shadow-[0_24px_80px_-32px_rgb(0_0_0/0.55)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section className="flex flex-col p-7 sm:p-10 lg:p-14">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center overflow-hidden">
              {iconFailed ? (
                <Icon className="h-8 w-8 text-blue-600" />
              ) : (
                <img
                  src={iconUrl}
                  onError={() => {
                    if (iconUrl !== "/icon-96.png") setIconUrl("/icon-96.png");
                    else setIconFailed(true);
                  }}
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              )}
            </span>
            <span className="wordmark truncate text-sm text-ink-soft" aria-label={branding.appName}>
              <span className="text-accent">~/</span>
              {branding.appName.toLowerCase().replace(/\s+/g, "-")}
              <span aria-hidden="true" className="ml-1 inline-block h-3.5 w-2 translate-y-0.5 bg-ink motion-safe:animate-caret-blink" />
            </span>
          </div>

          <div className="mt-10 sm:mt-6 lg:mt-8">
            <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="mt-5 max-w-md text-base leading-7 text-ink-muted">
                {description}
              </p>
            )}
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <LanguageSelector variant="text" />
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-start border-line px-7 lg:border-l pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-0 sm:justify-center sm:p-10 lg:p-14">
          {steps && (
            <div className="mb-7 flex flex-wrap gap-2 font-mono text-xs font-medium">
              {steps.map((step, index) => (
                <span key={step.label} className="flex items-center gap-2">
                  <span
                    className={
                      step.active ? "text-blue-700" : "text-neutral-500"
                    }
                  >
                    {index + 1} {step.label}
                  </span>
                  {index < steps.length - 1 && (
                    <span className="text-neutral-300">/</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="w-full">{children}</div>
          {footer && (
            <div className="mt-8 text-sm font-medium text-blue-700">
              {footer}
            </div>
          )}
          <div className="mt-auto pt-8 lg:hidden">
            <LanguageSelector variant="text" />
          </div>
        </section>
      </main>
    </div>
  );
}
