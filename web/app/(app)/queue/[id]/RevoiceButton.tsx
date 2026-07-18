"use client";

// Job-level revision: pick a different voice, re-synthesize the whole
// voiceover, re-run assembly. Video clips are untouched. Mirrors
// RerollSceneButton.tsx's shape.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VOICE_OPTIONS, humanizeStudioError, revoiceJob } from "@/lib/studio-client";

export function RevoiceButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [voice, setVoice] = React.useState<string>(VOICE_OPTIONS[0]);
  const [pending, setPending] = React.useState(false);

  async function onSubmit() {
    setPending(true);
    try {
      const revision = await revoiceJob(jobId, voice);
      setOpen(false);
      toast.success("Revision queued", {
        action: {
          label: "View job",
          onClick: () => router.push(`/queue/${revision.id}`),
        },
      });
    } catch (e) {
      // Includes the 409 "source assets expired; use retry" case verbatim.
      toast.error(humanizeStudioError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} type="button">
        <Mic className="h-4 w-4" />
        Re-voice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Re-voice this job</DialogTitle>
            <DialogDescription>
              Re-synthesizes the whole voiceover with a different voice and
              re-runs assembly. Scene clips are untouched.
            </DialogDescription>
          </DialogHeader>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_OPTIONS.map((v) => (
                <SelectItem key={v} value={v} className="capitalize">
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending ? "Queuing…" : "Re-voice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
