import { cn } from "@/lib/utils";

type Props = {
	name: string;
	color: string;
	className?: string;
};

/** The colored dot that marks a message's project in lists and the sidebar. */
export function ProjectDot({ name, color, className }: Props) {
	return (
		<span
			role="img"
			aria-label={name}
			title={name}
			data-project-dot=""
			className={cn("inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10", className)}
			style={{ backgroundColor: color }}
		/>
	);
}
