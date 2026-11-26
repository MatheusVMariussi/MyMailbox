import type { DomainDnsView } from "@/lib/domains/service";

/**
 * The DNS view for a domain MyMailbox does not manage on Cloudflare. The app cannot read or write
 * that zone, so the DMARC record shows as missing until it is attached to its Cloudflare zone;
 * MX and SPF depend on the receiving and sending provider and come from that provider's own setup.
 */
export function getManualDomainDns(hostname: string): DomainDnsView {
	return {
		routing: { records: [], missing: [{ type: "TXT", name: `_dmarc.${hostname}`, content: "v=DMARC1; p=none", ttl: 3600 }], status: "manual" },
		sending: [],
		sendingEnabled: false,
	};
}
