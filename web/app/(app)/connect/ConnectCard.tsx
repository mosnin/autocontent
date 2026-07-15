"use client";

import { CheckCircle2, Link2 } from "lucide-react";

import { DotGridSpotlight } from "@/components/dot-grid-spotlight";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ConnectCard({
  action,
  connected,
  maskedKey,
}: {
  action: () => Promise<void>;
  connected: boolean;
  maskedKey: string | null;
}) {
  return (
    <Card className="relative isolate overflow-hidden">
      {/* Cursor-reactive dot field behind the card — the surface feels wired
          in, matching the marketing hero's grammar. */}
      <DotGridSpotlight
        activeDotColor="hsl(var(--brand) / 0.5)"
        className="absolute inset-0 -z-10 opacity-70"
        dotColor="hsl(var(--muted-foreground) / 0.12)"
        interactionRadius={140}
        spacing={22}
      />
      <CardHeader className="items-center text-center">
        <div
          className={
            connected
              ? "relative mx-auto flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand"
              : "relative mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          {connected && (
            <span
              aria-hidden
              className="absolute inline-flex size-3 animate-ping rounded-full bg-brand opacity-60 [inset-block-start:0.35rem] [inset-inline-end:0.35rem]"
            />
          )}
          <Link2 className="size-6" />
        </div>
        <CardTitle className="mt-1">
          {connected ? "Posting profile created" : "Connect Ayrshare"}
        </CardTitle>
        <CardDescription className="max-w-sm">
          {connected
            ? "Your Ayrshare posting profile is ready. Open the hosted chooser any time to link, add, or revoke individual platforms."
            : "We'll bounce you to Ayrshare's hosted chooser to create a posting profile and authorize each platform."}
        </CardDescription>
      </CardHeader>

      {connected && maskedKey && (
        <CardContent className="text-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-1.5 text-sm backdrop-blur">
            <CheckCircle2 className="size-4 text-success" />
            <span className="text-muted-foreground">profile_key</span>
            <code className="font-mono text-xs">{maskedKey}</code>
          </div>
        </CardContent>
      )}

      <CardFooter className="justify-center">
        <form action={action}>
          <Button size="lg" type="submit">
            {connected ? "Reconnect / add accounts" : "Connect socials"}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
