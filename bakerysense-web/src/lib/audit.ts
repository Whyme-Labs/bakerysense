import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";

export type AuditAction =
	| "tenant.created" | "user.signed_up"
	| "user.signed_in" | "user.signed_out"
	| "token.reuse_detected" | "token.refreshed"
	| "tenant.access.denied" | "connector.created"
	| "connector.deleted" | "connector.default_changed"
	| "oauth.initiated" | "oauth.completed"
	| "branch.created" | "branch.updated" | "branch.deleted"
	| "user.invited" | "member.role_changed" | "member.removed"
	| "user.password_changed"
	| "actuals.recorded" | "actuals.updated" | "actuals.deleted" | "actuals.bulk_imported"
	| "retrain.enqueued" | "retrain.published" | "retrain.aborted" | "drift.detected";

export async function writeAudit(
	env: CloudflareEnv,
	entry: { tenantId: string; actorUserId?: string; action: AuditAction; target?: string; metadata?: Record<string, unknown> },
): Promise<void> {
	try {
		const b = crypto.getRandomValues(new Uint8Array(9));
		const id = "aud_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
		await getDb(env).insert(auditLog).values({
			id,
			tenantId: entry.tenantId,
			actorUserId: entry.actorUserId,
			action: entry.action,
			target: entry.target,
			metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
			createdAt: Date.now(),
		});
	} catch (e) {
		console.error("audit_write_failed", entry.action, e);
		// never throw from the audit path — callers must not fail if audit fails
	}
}
