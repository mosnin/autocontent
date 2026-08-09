"use client";

// Weekly slot templates ("Mon 09:00 America/New_York"). A slot stores local
// wall-clock time, never an offset, so a post stays at 09:00 local across a
// DST transition instead of drifting an hour for half the year — the UI says
// so rather than showing a converted time that would look wrong twice a year.
//
// Deleting a template never deletes the posts it already produced (the FK is
// `on delete set null`), and some of those may already be live. Said out loud
// on the delete affordance.

import * as React from "react";
import useSWR from "swr";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { Input } from "@/components/square/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  PLATFORMS,
  WEEKDAYS,
  browserTimezone,
  createRecurringSlot,
  deleteRecurringSlot,
  platformLabel,
  scheduledErrorMessage,
  scheduledKeys,
  recurringSlotsFetcher,
  timezoneOptions,
  type RecurringSlot,
} from "@/lib/scheduled-client";

function timeLabel(slot: RecurringSlot): string {
  return `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
}

export function RecurringSlots({ initial }: { initial: RecurringSlot[] }) {
  const { data, mutate } = useSWR<RecurringSlot[]>(
    scheduledKeys.recurring(),
    recurringSlotsFetcher,
    { fallbackData: initial, revalidateOnFocus: false },
  );
  const slots = data ?? [];

  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [weekday, setWeekday] = React.useState(0);
  const [time, setTime] = React.useState("09:00");
  const [timezone, setTimezone] = React.useState(browserTimezone());
  const [platforms, setPlatforms] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const zones = React.useMemo(() => timezoneOptions(timezone), [timezone]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const [hh, mm] = time.split(":").map(Number);
    setSaving(true);
    try {
      const slot = await createRecurringSlot({
        label: label.trim(),
        weekday,
        hour: Number.isFinite(hh) ? hh : 9,
        minute: Number.isFinite(mm) ? mm : 0,
        timezone,
        platforms,
        active: true,
      });
      await mutate((rows) => [...(rows ?? []), slot], { revalidate: true });
      setLabel("");
      setPlatforms([]);
      setOpen(false);
      toast.success("Slot created");
    } catch (err) {
      toast.error(scheduledErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setRemoving(id);
    try {
      await deleteRecurringSlot(id);
      await mutate((rows) => (rows ?? []).filter((s) => s.id !== id), { revalidate: true });
      toast.success("Slot deleted — posts it already created are untouched");
    } catch (err) {
      toast.error(scheduledErrorMessage(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Recurring slots</CardTitle>
        <CardDescription>
          Weekly templates that define when you publish. A slot holds a local
          hour, so 09:00 stays 09:00 through a daylight-saving change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No slots yet. Add the times you want to be publishing every week.
          </p>
        ) : (
          <ul className="space-y-2">
            {slots.map((slot) => (
              <li
                key={slot.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
              >
                <span className="text-sm font-medium">
                  {WEEKDAYS[slot.weekday] ?? `Day ${slot.weekday}`} {timeLabel(slot)}
                </span>
                <span className="text-xs text-muted-foreground">{slot.timezone}</span>
                {slot.label ? (
                  <span className="text-xs text-muted-foreground">· {slot.label}</span>
                ) : null}
                <span className="flex flex-wrap gap-1">
                  {slot.platforms.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px]">
                      {platformLabel(p)}
                    </Badge>
                  ))}
                </span>
                {!slot.active ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Paused
                  </Badge>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label="Delete slot"
                  title="Deleting the template leaves every post it already created in place"
                  disabled={removing === slot.id}
                  onClick={() => void handleDelete(slot.id)}
                >
                  {removing === slot.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 aria-hidden />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <form onSubmit={handleCreate} className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="slot-weekday">Weekday</Label>
                <select
                  id="slot-weekday"
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {WEEKDAYS.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-time">Local time</Label>
                <Input
                  id="slot-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-tz">Timezone</Label>
                <select
                  id="slot-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-label">Label (optional)</Label>
                <Input
                  id="slot-label"
                  value={label}
                  maxLength={120}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Monday morning tip"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((name) => {
                  const on = platforms.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setPlatforms((prev) =>
                          prev.includes(name)
                            ? prev.filter((p) => p !== name)
                            : [...prev, name],
                        )
                      }
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {platformLabel(name)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Create slot
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            Add slot
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
