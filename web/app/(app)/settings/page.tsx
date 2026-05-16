import Link from "next/link";
import { KeyRound, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Index page for the settings sub-tree. Today it's just a two-card
// landing pad pointing at Connect and Tokens; new subsections can land
// here without rewiring navigation.
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections, authentication, and per-account config.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <Link2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Socials</CardTitle>
            <CardDescription>
              Link Ayrshare so scheduled posts actually ship.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/connect">Open</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">
              Personal access tokens
            </CardTitle>
            <CardDescription>
              For the CLI, MCP server, and external agents.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/settings/tokens">Manage</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
