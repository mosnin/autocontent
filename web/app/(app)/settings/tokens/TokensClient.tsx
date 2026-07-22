"use client";

import * as React from "react";
import { useActionState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/square/ui/dropdown-menu";
import { Input } from "@/components/square/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { createTokenAction, revokeTokenAction } from "@/lib/actions";
import { EMPTY_STATE, type ActionState } from "@/lib/action-state";
import type { PersonalAccessToken } from "@/lib/types";

interface Props {
  tokens: PersonalAccessToken[];
}

type CreateTokenState = ActionState & { token?: string };

export function TokensClient({ tokens }: Props) {
  const [createState, createFormAction] = useActionState<
    CreateTokenState,
    FormData
  >(createTokenAction, EMPTY_STATE);
  const [open, setOpen] = React.useState(false);

  // The plaintext token lives only in the action state — never in the
  // URL — and is rendered once here after a successful create.
  const freshToken = createState.ok ? (createState.token ?? null) : null;

  React.useEffect(() => {
    if (createState.ok && createState.token) setOpen(false);
  }, [createState]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="space-y-6">
      {freshToken && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="space-y-3 pt-6">
            <div className="text-sm font-medium">New token — shown once</div>
            <div className="flex items-center gap-2 rounded-md border bg-background p-2">
              <code className="flex-1 overflow-x-auto font-mono text-xs">
                {freshToken}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(freshToken)}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copy it into{" "}
              <code className="rounded bg-muted px-1">
                MARKETER_API_TOKEN
              </code>{" "}
              now — we don&apos;t store the plaintext and can&apos;t recover it.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Active tokens</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New token</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create personal access token</DialogTitle>
              <DialogDescription>
                The plaintext value is shown once after creation.
              </DialogDescription>
            </DialogHeader>
            <form action={createFormAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  name="name"
                  required
                  placeholder="laptop-cli"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-exp">Expires in days (optional)</Label>
                <Input
                  id="token-exp"
                  name="expires_in_days"
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="leave blank for non-expiring"
                />
              </div>
              {createState.error && (
                <p className="text-sm text-destructive">{createState.error}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {tokens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">No tokens</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a token to authenticate the CLI, MCP server, or any
              external agent driving marketer.sh.
            </p>
            <Button onClick={() => setOpen(true)}>
              Create your first token
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card flex flex-col">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Name
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Prefix
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Created
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Expires
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Last used
                  </TableHead>
                  <TableHead className="w-[60px] h-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((t) => (
                  <TokenRow key={t.id} token={t} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenRow({ token }: { token: PersonalAccessToken }) {
  async function onRevoke() {
    if (!confirm(`Revoke token "${token.name}"? This can't be undone.`)) return;
    const fd = new FormData();
    fd.set("token_id", token.id);
    const res = await revokeTokenAction({ ok: false }, fd);
    if (res.ok) toast.success("Token revoked");
    else toast.error(res.error ?? "Revoke failed");
  }

  return (
    <TableRow className="border-b last:border-0 hover:bg-muted/30">
      <TableCell className="py-3 font-medium">{token.name}</TableCell>
      <TableCell className="py-3">
        <code className="font-mono text-xs">{token.prefix}</code>
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">
        {new Date(token.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">
        {token.expires_at ? new Date(token.expires_at).toLocaleString() : "—"}
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">
        {token.last_used_at
          ? new Date(token.last_used_at).toLocaleString()
          : "never"}
      </TableCell>
      <TableCell className="py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More options for token ${token.name}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void onRevoke();
              }}
              className="text-destructive focus:text-destructive"
            >
              Revoke
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
