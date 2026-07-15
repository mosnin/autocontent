import { api } from "@/lib/api";
import type { PersonalAccessToken } from "@/lib/types";
import { TokensClient } from "./TokensClient";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const tokens = await api<PersonalAccessToken[]>("/api/v1/tokens");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Agent access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Personal access tokens
        </h1>
        <p className="text-sm text-muted-foreground">
          Tokens authenticate the CLI, the MCP server, and any external agent
          driving marketer.sh. They start with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">mkt_</code>{" "}
          and can do anything your account can. Treat them like passwords.
        </p>
      </div>

      <TokensClient tokens={tokens} />
    </div>
  );
}
