"use client";

// Per-scene revision: opens a small dialog asking what should change,
// then POSTs the reroll and hands back a link to the new revision job.
// Mirrors RetryButton.tsx's shape (local pending state, toast on result).

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { humanizeStudioError, rerollScene } from "@/lib/studio-client";

export function RerollSceneButton({
  jobId,
  sceneIndex,
}: {
  jobId: string;
  sceneIndex: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function onSubmit() {
    const trimmed = direction.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      const revision = await rerollScene(jobId, sceneIndex, trimmed);
      setOpen(false);
      setDirection("");
      toast.success("Revision queued", {
        action: {
          label: "View job",
          onClick: () => router.push(`/queue/${revision.id}`),
        },
      });
    } catch (e) {
      // Includes the 409 "source assets expired; use retry" case verbatim —
      // the backend's message already points at Retry.
      toast.error(humanizeStudioError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} type="button">
        <Wand2 className="h-4 w-4" />
        Reroll scene
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reroll scene {sceneIndex + 1}</DialogTitle>
            <DialogDescription>
              What should change? Only this scene&apos;s keyframe and clip are
              regenerated, everything else stays.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Darker lighting, closer camera, different background"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={pending || !direction.trim()}>
              {pending ? "Queuing…" : "Reroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
