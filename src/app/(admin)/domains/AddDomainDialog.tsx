"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { CheckCircle2, LoaderCircle } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { notifyMailboxesChanged } from "@/components/mailbox-provider-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, createDomain, isMxConflictError } from "./api";
import { sendingProblemMessage } from "./sending-problem-utils";
import type { Domain, DomainPreflight, ReceivingProvider, SendingProvider } from "./types";
import { checkDomain } from "./utils";

type AddDomainDialogProps = {
  /** The button that opens the dialog. */
  trigger: ReactNode;
  /** Replaces the default description, for a caller that does more with the new domain. */
  description?: ReactNode;
  /** Shown above the form, for what the caller wants the admin to check first. */
  notice?: ReactNode;
  /** Runs after the domain exists, once the dialog has closed. */
  onCreated?: (domain: Pick<Domain, "id" | "hostname">) => void;
};

/**
 * Adds a domain: checks the Cloudflare zone, provisions Email Routing (and Email Sending when chosen) through
 * `/api/domains`, which applies the Admin permission rules. Used by Admin → Domains, Settings → Domains and
 * each project in Settings → Projects.
 */
export function AddDomainDialog({ trigger, description, notice, onCreated }: AddDomainDialogProps) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState("");
  const [domainCheck, setDomainCheck] = useState<DomainPreflight | null>(null);
  const [domainChecking, setDomainChecking] = useState(false);
  const [skipDns, setSkipDns] = useState(false);
  const [sendingProvider, setSendingProvider] = useState<SendingProvider>("cloudflare");
  const [receivingProvider, setReceivingProvider] = useState<ReceivingProvider>("cloudflare");
  const [domainCheckError, setDomainCheckError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const normalized = hostname.toLowerCase().trim();
      let checkedDomain = domainCheck;
      if (skipDns) {
        checkedDomain = { hostname: normalized, zone: { id: "manual", name: normalized } };
      } else if (checkedDomain?.hostname !== normalized) {
        const result = await checkDomain(normalized);
        if (!result.ok || !result.domain) {
          throw new Error(result.error ?? t("onboarding.domainCheckFailed"));
        }
        checkedDomain = result.domain;
        setDomainCheck(result.domain);
      }
      if (!checkedDomain) throw new Error(t("onboarding.domainCheckFailed"));

      const result = await createDomain({
        hostname: checkedDomain.hostname,
        enableRouting: true,
        skipDns,
        sendingProvider,
        receivingProvider,
      });
      return result.domain as Pick<Domain, "id" | "hostname"> | undefined;
    },
    onSuccess: (domain) => {
      setHostname("");
      setDomainCheck(null);
      setSkipDns(false);
      setSendingProvider("cloudflare");
      setReceivingProvider("cloudflare");
      setDomainCheckError(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["domains"] });
      // A domain adds sender addresses to mailboxes that use every domain.
      notifyMailboxesChanged();
      if (domain?.id) onCreated?.({ id: domain.id, hostname: domain.hostname });
    },
  });

  // Cloudflare refused Email Sending for a reason fixed in its dashboard (token permission, onboarding).
  const createSendingProblem = create.error instanceof ApiError
    ? sendingProblemMessage((create.error.data as { code?: unknown } | null)?.code, hostname.toLowerCase().trim(), t)
    : null;

  const inspectDomain = async () => {
    const normalized = hostname.toLowerCase().trim();
    if (skipDns || normalized.length < 3 || domainCheck?.hostname === normalized) return;

    setDomainChecking(true);
    setDomainCheckError(null);
    const result = await checkDomain(normalized);
    setDomainChecking(false);
    if (!result.ok || !result.domain) {
      setDomainCheck(null);
      setDomainCheckError(result.error ?? t("onboarding.domainCheckFailed"));
      return;
    }

    setDomainCheck(result.domain);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("domains.addTitle")}</DialogTitle>
          <DialogDescription>
            {description ?? t("domains.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {notice}
          <div className="space-y-2">
            <Label htmlFor="hostname">{t("domains.hostname")}</Label>
            <Input
              id="hostname"
              value={hostname}
              onChange={(e) => {
                setHostname(e.target.value);
                if (domainCheck?.hostname !== e.target.value.toLowerCase().trim()) {
                  setDomainCheck(null);
                }
              }}
              onBlur={() => void inspectDomain()}
              placeholder="example.com"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-neutral-50 px-4 py-3">
            <div>
              <Label htmlFor="skip-dns">{t("setup.skipDns")}</Label>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {skipDns ? t("setup.skipDnsOn") : t("setup.skipDnsHint")}
              </p>
            </div>
            <Switch
              id="skip-dns"
              checked={skipDns}
              onCheckedChange={(checked) => {
                setSkipDns(checked);
                setDomainCheckError(null);
              }}
            />
          </div>
          {!skipDns && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl bg-neutral-50 px-4 py-3">
                <div>
                  <Label htmlFor="receiving-provider">{t("domains.receiveWith")}</Label>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {receivingProvider === "cloudflare"
                      ? t("domains.receiveHintCloudflare")
                      : t("domains.receiveHintNone")}
                  </p>
                </div>
                <Select
                  id="receiving-provider"
                  value={receivingProvider}
                  onChange={(e) => setReceivingProvider(e.target.value as ReceivingProvider)}
                  containerClassName="h-9 shrink-0 rounded-md bg-white px-0"
                  className="px-3 text-sm"
                >
                  <option value="cloudflare">{t("domains.cloudflareRouting")}</option>
                  <option value="none">{t("domains.notSelected")}</option>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl bg-neutral-50 px-4 py-3">
                <div>
                  <Label htmlFor="sending-provider">{t("domains.sendWith")}</Label>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {domainChecking
                      ? t("setup.checkingCloudflare")
                      : sendingProvider === "cloudflare"
                        ? t("domains.sendHintCloudflare")
                        : t("domains.sendHintNone")}
                  </p>
                </div>
                {domainChecking && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-neutral-500" />}
                <Select
                  id="sending-provider"
                  value={sendingProvider}
                  onChange={(e) => setSendingProvider(e.target.value as SendingProvider)}
                  containerClassName="h-9 shrink-0 rounded-md bg-white px-0"
                  className="px-3 text-sm"
                >
                  <option value="cloudflare">{t("domains.cloudflareSending")}</option>
                  <option value="none">{t("domains.notSelected")}</option>
                </Select>
              </div>
            </>
          )}
          {domainCheck && !skipDns && (
            <div className="flex items-center gap-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {t("setup.domainFound", { zone: domainCheck.zone.name })}
            </div>
          )}
          {domainCheckError && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {domainCheckError}
            </p>
          )}
          {create.isError && createSendingProblem && (
            <div className="space-y-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{createSendingProblem}</p>
              <p>{t("domains.sendingLaterHint")}</p>
            </div>
          )}
          {create.isError && !createSendingProblem && (
            <div className="space-y-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{(create.error as Error).message}</p>
              {!isMxConflictError(create.error) && (
                <div className="space-y-2">
                  <p className="font-medium">
                    {t("domains.tokenPermissions")}
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      {t("domains.tokenAccounts")}
                    </li>
                    <li>
                      {t("domains.tokenZones")}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
          <Button
            onClick={() => create.mutate()}
            disabled={!hostname || domainChecking || create.isPending}
          >
            {create.isPending ? t("onboarding.adding") : t("domains.addTitle")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
