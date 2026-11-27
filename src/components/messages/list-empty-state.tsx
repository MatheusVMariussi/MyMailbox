type ListEmptyStateProps = {
	/** What the list ran, as a shell command (`ls inbox`, `grep "invoice"`). */
	command: string;
	/** The command's one-line output (`0 conversations`). */
	result: string;
	/** A short line in plain words. */
	message: string;
};

/** An empty list (folder, label, project or search) in the terminal motif: the command, its output, a line of copy. */
export function ListEmptyState({ command, result, message }: ListEmptyStateProps) {
	return (
		<div className="px-5 py-8" data-list-empty="">
			<p className="flex min-w-0 items-center gap-2 font-mono text-[13px] leading-5 text-ink-soft" aria-hidden="true">
				<span className="shrink-0 text-accent">$</span>
				<span className="truncate">{command}</span>
			</p>
			<p className="mt-1 pl-4 font-mono text-[12px] leading-5 text-ink-muted" aria-hidden="true">{result}</p>
			<p className="mt-4 text-sm leading-6 text-ink-muted">{message}</p>
		</div>
	);
}
