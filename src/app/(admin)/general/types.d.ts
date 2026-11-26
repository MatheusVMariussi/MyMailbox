export interface GeneralSettings {
	outboundAttachmentMaxMb: number;
	outboundAttachmentCeilingMb: number;
	/** CalDAV/CardDAV sync; off until an administrator turns it on. */
	davEnabled: boolean;
}
