import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

// flue() must come before cloudflare(), and cloudflare() must receive Flue's worker config.
// Workers AI / Vectorize / AI Search bindings run remotely in dev (needs `wrangler login` or CLOUDFLARE_API_TOKEN).
// Set AGENT_STARTER_LOCAL_ONLY=1 for offline smoke tests / CI without Cloudflare credentials.
// One copy of the agent runtime: Flue hooks keep per-render state in module scope, so a second
// copy (workspaces, vendored packages, mismatched peer variants) would split the hook context.
const dedupe = ["@flue/runtime", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"];

export default defineConfig({
  resolve: { dedupe },
  plugins: [flue(), cloudflare({ config: flueWorkerConfig(), remoteBindings: process.env.AGENT_STARTER_LOCAL_ONLY !== "1" })],
});
