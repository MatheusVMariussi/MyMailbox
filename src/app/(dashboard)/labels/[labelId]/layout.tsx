"use client";

import { useParams } from "next/navigation";
import { MessageSplitLayout } from "@/components/messages/message-split-layout";
import { useLabelConfig } from "@/components/messages/use-label-config";

export default function LabelLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const params = useParams<{ labelId: string }>();
	const config = useLabelConfig(params.labelId);

	return <MessageSplitLayout config={config}>{children}</MessageSplitLayout>;
}
