"use client";

import { mobilePrimaryActionClass } from "@/components/page-header-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { notifyMailboxesChanged } from "@/components/mailbox-provider-utils";
import { Button } from "@/components/ui/button";
import { alertDialog, confirmDestructive } from "@/components/ui/confirm-dialog";
import { List } from "@/components/ui/list";
import { Plus } from "@/components/icons";
import { authFetch } from "@/lib/auth/client";
import type { DnsAuthRecord, DnsStatusSummary, Domain, DomainDnsCache, DomainDnsView, ReceivingProvider, SendingProvider } from "./types";
import DomainItemCard from "./DomainItemCard";
import { AddDomainDialog } from "./AddDomainDialog";
import { SectionRowSkeleton } from "@/components/page-skeletons";
import { confirmMxReplacement } from "./api";
import { sendingProblemMessage } from "./sending-problem-utils";

export default function DomainsPage() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  // Without Cloudflare API credentials DNS is managed by hand.
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await (await authFetch("/api/auth/me")).json()) as { managesDns?: boolean },
  });
  const managesDns = me?.managesDns ?? true;
  const [setupRecord, setSetupRecord] = useState<DnsAuthRecord | null>(null);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  // Which record the setup message is about: a DKIM failure is shown with the sending setup.
  const [setupMessageRecord, setSetupMessageRecord] = useState<DnsAuthRecord | null>(null);
  const [expandedDomainId, setExpandedDomainId] = useState<string | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [dnsViews, setDnsViews] = useState<DomainDnsCache>({});

  const { data, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: async () => {
      const res = await authFetch("/api/domains?includeDns=true");
      return (await res.json()) as {
        domains: Domain[];
        dns: Record<string, DnsStatusSummary>;
      };
    },
  });

  // A policy or TLS reports still published for the domain make the server answer 409; an admin can then force the
  // delete by typing the host name. The answer lists the DNS records that are left to remove by hand.
  const remove = useMutation({
    mutationFn: async (domain: { id: string; hostname: string }) => {
      const send = (force: boolean) =>
        authFetch(`/api/domains/${domain.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: force ? JSON.stringify({ force: true, confirm: domain.hostname }) : undefined,
        });
      let res = await send(false);
      let json = (await res.json().catch(() => null)) as { error?: string; code?: string; leftovers?: { name: string; type: string }[]; cachedUntil?: string | null } | null;
      if (res.status === 409 && (json?.code === "MTA_STS_PUBLISHED" || json?.code === "TLS_RPT_ENABLED")) {
        const forced = await confirmDestructive({
          title: t("domains.forceRemove"),
          message: t("domains.forceRemoveConfirm", { reason: json.error ?? "", host: domain.hostname }),
          requireText: domain.hostname,
          confirmLabel: t("domains.forceRemove"),
        });
        if (!forced) return null;
        res = await send(true);
        json = (await res.json().catch(() => null)) as typeof json;
      }
      if (!res.ok) throw new Error(json?.error ?? t("domains.removeFailed"));
      return { hostname: domain.hostname, leftovers: json?.leftovers ?? [], cachedUntil: json?.cachedUntil ?? null };
    },
    onSuccess: async (result) => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      // Removing a domain removes its mailboxes and their sender addresses.
      if (result) notifyMailboxesChanged();
      if (!result || (result.leftovers.length === 0 && !result.cachedUntil)) return;
      const lines = result.leftovers.map((record) => `${record.type} ${record.name}`);
      await alertDialog({
        title: t("domains.forceRemoved", { host: result.hostname }),
        message: [
          lines.length > 0 ? `${t("domains.forceRemovedRecords")}\n${lines.join("\n")}` : "",
          result.cachedUntil ? t("domains.forceRemovedCache", { date: new Date(result.cachedUntil).toLocaleDateString() }) : "",
        ].filter(Boolean).join("\n\n"),
      });
    },
    onError: (error) => void alertDialog(error.message),
  });

  const loadDns = async (id: string) => {
    const res = await authFetch(`/api/domains/${id}/dns`);
    const json = (await res.json()) as {
      domain?: Domain;
      dns?: DomainDnsView;
      error?: string;
    };
    if (!res.ok || !json.domain || !json.dns) {
      throw new Error(json.error ?? t("domains.dnsLoadFailed"));
    }
    const loadedView = { domain: json.domain, dns: json.dns };
    setDnsViews((current) => ({ ...current, [id]: loadedView }));
    if (expandedIdRef.current === id) setSetupMessage(null);
  };

  const toggleDns = async (id: string) => {
    if (expandedDomainId === id) {
      expandedIdRef.current = null;
      setExpandedDomainId(null);
      setSetupMessage(null);
      setDnsLoading(false);
      setDnsError(null);
      return;
    }
    // Expand immediately and show a skeleton while the audit is fetched, rather
    // than leaving the card unchanged until the request resolves.
    expandedIdRef.current = id;
    setExpandedDomainId(id);
    setSetupMessage(null);
    setDnsError(null);
    if (dnsViews[id]) {
      setDnsLoading(false);
      return;
    }
    setDnsLoading(true);
    try {
      await loadDns(id);
    } catch (error) {
      if (expandedIdRef.current === id) {
        setDnsError(error instanceof Error ? error.message : t("domains.dnsLoadFailed"));
      }
    } finally {
      if (expandedIdRef.current === id) setDnsLoading(false);
    }
  };

  const [sendingBusy, setSendingBusy] = useState(false);
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);

  const hostnameOf = (id: string) => dnsViews[id]?.domain.hostname ?? data?.domains.find((domain) => domain.id === id)?.hostname ?? "";

  const changeSendingProvider = async (provider: SendingProvider) => {
    if (!expandedDomainId) return;
    const id = expandedDomainId;
    setSendingBusy(true);
    setSendingMessage(null);
    try {
      const put = async (replaceMx: boolean) => {
        const res = await authFetch(`/api/domains/${id}/sending`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, replaceMx }),
        });
        return { res, json: (await res.json()) as { warning?: string; warningCode?: string; error?: string; code?: string; records?: { content: string; priority: number }[] } };
      };
      let { res, json } = await put(false);
      // Cloudflare sending refuses while another service's MX records exist.
      if (await confirmMxReplacement(res, json)) ({ res, json } = await put(true));
      if (!res.ok) throw new Error(sendingProblemMessage(json.code, hostnameOf(id), t) ?? json.error ?? t("domains.sendingChangeFailed"));
      // The choice is saved even when Cloudflare refused the setup; say what to fix in the dashboard.
      if (json.warning) setSendingMessage(sendingProblemMessage(json.warningCode, hostnameOf(id), t) ?? json.warning);
      await loadDns(id);
      qc.invalidateQueries({ queryKey: ["domains"] });
    } catch (error) {
      setSendingMessage(error instanceof Error ? error.message : t("domains.sendingChangeFailed"));
    } finally {
      setSendingBusy(false);
    }
  };

  const [receivingBusy, setReceivingBusy] = useState(false);
  const [receivingMessage, setReceivingMessage] = useState<string | null>(null);

  const changeReceivingProvider = async (provider: ReceivingProvider) => {
    if (!expandedDomainId) return;
    const id = expandedDomainId;
    setReceivingBusy(true);
    setReceivingMessage(null);
    try {
      const res = await authFetch(`/api/domains/${id}/receiving`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("domains.receivingChangeFailed"));
      await loadDns(id);
      qc.invalidateQueries({ queryKey: ["domains"] });
    } catch (error) {
      setReceivingMessage(error instanceof Error ? error.message : t("domains.receivingChangeFailed"));
    } finally {
      setReceivingBusy(false);
    }
  };

  const refreshExpandedDns = () => {
    if (!expandedDomainId) return;
    void loadDns(expandedDomainId).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["domains"] });
  };

  const setupDns = async (record: DnsAuthRecord) => {
    if (!expandedDomainId) return;
    const dnsView = dnsViews[expandedDomainId];
    if (!dnsView) return;
    setSetupRecord(record);
    setSetupMessage(null);
    setSetupMessageRecord(record);
    try {
      const post = async (replaceMx: boolean) => {
        const res = await authFetch(`/api/domains/${dnsView.domain.id}/dns/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record, replaceMx }),
        });
        return {
          res,
          json: (await res.json()) as {
            domain?: Domain;
            dns?: DomainDnsView;
            error?: string;
            code?: string;
            records?: { content: string; priority: number }[];
          },
        };
      };
      let { res, json } = await post(false);
      if (await confirmMxReplacement(res, json)) ({ res, json } = await post(true));
      if (!res.ok) throw new Error(sendingProblemMessage(json.code, dnsView.domain.hostname, t) ?? json.error ?? t("domains.dnsSetupFailed"));
      if (json.domain && json.dns) {
        const updatedView = { domain: json.domain, dns: json.dns };
        setDnsViews((current) => ({
          ...current,
          [dnsView.domain.id]: updatedView,
        }));
      } else await loadDns(dnsView.domain.id);
      qc.invalidateQueries({ queryKey: ["domains"] });
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : t("domains.dnsSetupFailed"));
    } finally {
      setSetupRecord(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-medium">{t("domains.title")}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {managesDns
              ? t("domains.descriptionManaged")
              : t("domains.descriptionManual")}
          </p>
        </div>
        <AddDomainDialog
          trigger={(
            <Button className={mobilePrimaryActionClass}>
              <Plus className="h-4 w-4" />
              {t("domains.new")}
            </Button>
          )}
        />
      </div>
      <section className="space-y-3">
        {/* <div className="flex items-center justify-between">
					<span className="text-sm text-neutral-500">{(data?.domains ?? []).length} total</span>
				</div> */}
        {isLoading && (
          <SectionRowSkeleton />
        )}
        {!isLoading && (data?.domains ?? []).length === 0 && (
          <p className="rounded-2xl bg-white px-5 py-4 text-sm text-neutral-500">
            {t("domains.none")}
          </p>
        )}
        <List>
          {(data?.domains ?? []).map((d) => {
            const dns = data?.dns?.[d.id];
            return (
              <DomainItemCard
                key={d.id}
                dns={dns}
                dnsDetails={dnsViews[d.id]?.dns}
                onSendingProviderChange={changeSendingProvider}
                sendingProviderBusy={sendingBusy}
                sendingProviderMessage={expandedDomainId === d.id ? sendingMessage : null}
                onReceivingProviderChange={changeReceivingProvider}
                receivingProviderBusy={receivingBusy}
                receivingProviderMessage={expandedDomainId === d.id ? receivingMessage : null}
                onDnsChanged={refreshExpandedDns}
                dnsLoading={expandedDomainId === d.id && dnsLoading}
                dnsError={expandedDomainId === d.id ? dnsError : null}
                expanded={expandedDomainId === d.id}
                onToggleDns={toggleDns}
                onSetup={setupDns}
                setupRecord={setupRecord}
                setupMessage={setupMessage}
                setupMessageRecord={setupMessageRecord}
                item={d}
                remove={remove}
              />
            );
          })}
        </List>
      </section>
    </div>
  );
}
