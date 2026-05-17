"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateUserSettingsAction } from "@/lib/actions";

interface Props {
  initialCap: string | null;
}

const INITIAL_STATE = { ok: false as boolean, error: undefined as string | undefined };

export function SpendCapForm({ initialCap }: Props) {
  const [state, formAction, pending] = useActionState(
    updateUserSettingsAction,
    INITIAL_STATE,
  );

  React.useEffect(() => {
    if (state.ok) toast.success("Spend cap saved");
    if (!state.ok && state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="global_daily_cap_usd">
          Global daily cap (USD)
        </Label>
        <Input
          id="global_daily_cap_usd"
          name="global_daily_cap_usd"
          type="number"
          step="0.01"
          min="0"
          placeholder="No global cap"
          defaultValue={initialCap ?? ""}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          Applies across all niches. Leave blank to use only per-niche caps.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
