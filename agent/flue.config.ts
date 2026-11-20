import { defineConfig } from "@flue/runtime/config";

// Agents are discovered from `'use agent'` modules under src/. Deployed to Cloudflare Workers:
// every agent becomes a Durable Object class; each conversation id is one instance with its own SQLite.
export default defineConfig({ target: "cloudflare" });
