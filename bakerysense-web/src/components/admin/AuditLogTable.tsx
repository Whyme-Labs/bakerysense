interface AuditEntry {
	id: string;
	tenantId: string;
	actorUserId: string | null;
	action: string;
	target: string | null;
	metadataJson: string | null;
	createdAt: number;
}

interface Props {
	entries: AuditEntry[];
}

export function AuditLogTable({ entries }: Props) {
	if (entries.length === 0) {
		return <p className="text-sm text-[var(--ink-muted)]">No audit log entries yet.</p>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="min-w-full text-sm">
				<thead>
					<tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--ink-subtle)]">
						<th className="pb-2 pr-4 font-medium">Time</th>
						<th className="pb-2 pr-4 font-medium">Action</th>
						<th className="pb-2 pr-4 font-medium">Actor</th>
						<th className="pb-2 font-medium">Target</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-[var(--border)]">
					{entries.map((entry) => (
						<tr key={entry.id}>
							<td className="py-2 pr-4 text-[var(--ink-muted)] whitespace-nowrap">
								{new Date(entry.createdAt).toLocaleString()}
							</td>
							<td className="py-2 pr-4">
								<code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-xs">{entry.action}</code>
							</td>
							<td className="py-2 pr-4 text-[var(--ink-muted)] truncate max-w-[12rem]">
								{entry.actorUserId ?? <span className="italic">system</span>}
							</td>
							<td className="py-2 text-[var(--ink-muted)] truncate max-w-[12rem]">
								{entry.target ?? "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
