import { rotateKeys } from "@/lib/auth/jwks";

export default {
	async scheduled(_event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil((async () => {
			const { newKid, retiredKid } = await rotateKeys(env);
			console.log("jwks.rotated", { newKid, retiredKid });
		})());
	},
};
