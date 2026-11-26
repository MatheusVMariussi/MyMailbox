"use client";

import { useParams } from "next/navigation";
import { MessageSplitLayout } from "@/components/messages/message-split-layout";
import { useLabelConfig } from "@/components/messages/use-label-config";
import { decodeLabelSegment } from "@/lib/labels/group-utils";

export default function LabelLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const params = useParams<{ labelId: string }>();
	// A grouped label's segment joins several ids with commas, which may arrive percent-encoded.
	const config = useLabelConfig(decodeLabelSegment(params.labelId));

	return <MessageSplitLayout config={config}>{children}</MessageSplitLayout>;
}
