import { enqueueRetrain } from "@/lib/retrain";
import { getDb } from "@/db/client";
import { tenants, dailyActuals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export default {
	async scheduled(_controller: ScheduledController, env: CloudflareEnv, _ctx: ExecutionContext): Promise<void> {
		const db = getDb(env);
		const candidates = await db
			.select({ tid: tenants.id, count: sql<number>`count(${dailyActuals.id})` })
			.from(tenants)
			.leftJoin(dailyActuals, eq(dailyActuals.tenantId, tenants.id))
			.groupBy(tenants.id)
			.having(sql`count(${dailyActuals.id}) >= 30`)
			.all();
		for (const c of candidates) {
			try {
				await enqueueRetrain(env, c.tid, "cron");
			} catch (e) {
				console.error("cron_enqueue_failed", c.tid, (e as Error).message);
			}
		}
	},
};
