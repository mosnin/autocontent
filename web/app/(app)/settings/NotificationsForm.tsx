"use client";

import * as React from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateEmailNotificationsAction } from "@/lib/actions";

interface Props {
  initialEnabled: boolean;
}

export function NotificationsForm({ initialEnabled }: Props) {
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [pending, startTransition] = React.useTransition();

  function onToggle(next: boolean) {
    // Optimistic: flip immediately, revert if the server rejects.
    const previous = enabled;
    setEnabled(next);
    startTransition(async () => {
      const res = await updateEmailNotificationsAction(next);
      if (!res.ok) {
        setEnabled(previous);
        toast.error(res.error ?? "Couldn't save your preference");
      } else {
        toast.success(next ? "Email notifications on" : "Email notifications off");
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="email-notifications" className="text-sm font-medium leading-none">
          Email notifications
        </Label>
        <p className="max-w-md text-xs text-muted-foreground">
          Get an email when a video is ready to review, a video or article
          finishes, or a run fails. Programmatic events are always available
          via webhooks regardless of this setting.
        </p>
      </div>
      <Switch
        id="email-notifications"
        checked={enabled}
        disabled={pending}
        onCheckedChange={onToggle}
        aria-label="Toggle email notifications"
      />
    </div>
  );
}
