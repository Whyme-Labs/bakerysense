// Production Worker entry. Wraps the OpenNext-built HTTP handler with the
// CHAT_QUEUE / RETRAIN_QUEUE consumer logic from src/lib/queue-consumer.ts.
// OpenNext's generated .open-next/worker.js only exports { fetch }; Cloudflare
// rejects the deploy if wrangler.jsonc declares a consumer but the script
// has no queue() handler. This file adds it.

// @ts-expect-error — built output, not in tsconfig paths
import openNextWorker from "./.open-next/worker.js";
import queueConsumer from "./src/lib/queue-consumer";

export { DOQueueHandler } from "./.open-next/worker.js";
export { DOShardedTagCache } from "./.open-next/worker.js";
export { BucketCachePurge } from "./.open-next/worker.js";

export default {
	fetch: (openNextWorker as { fetch: ExportedHandlerFetchHandler<CloudflareEnv> }).fetch,
	queue: queueConsumer.queue,
} satisfies ExportedHandler<CloudflareEnv>;
