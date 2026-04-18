import { seedDemo } from "@/db/seed";

export default {
	async fetch(req: Request, env: CloudflareEnv): Promise<Response> {
		if (req.method !== "POST") return new Response("POST only", { status: 405 });
		await seedDemo(env);
		return new Response("seeded");
	},
};
