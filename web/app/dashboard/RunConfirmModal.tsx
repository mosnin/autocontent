"use client";

import { useState, useTransition } from "react";
import {
  Modal,
  Stack,
  Text,
  Group,
  Button,
  Badge,
  Divider,
  Alert,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";

import { enqueueJobAction, EMPTY_STATE } from "../../lib/actions";
import { formatUsd } from "../../lib/format";
import { estimateVideoCostUsd } from "../../lib/cost-estimator";
import type { Niche, Platform } from "../../lib/types";

interface Props {
  opened: boolean;
  onClose: () => void;
  niche: Niche | null;
  platform: Platform | null;
  /** Today's spend for this niche (string-decimal). */
  spentToday: string;
}

// Shared modal for confirming a "run now" action. Triggered from
// per-platform buttons on the dashboard and from the spotlight palette.
export function RunConfirmModal({
  opened,
  onClose,
  niche,
  platform,
  spentToday,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!niche || !platform) {
    return (
      <Modal opened={opened} onClose={onClose} title="Run now" centered>
        <Text c="dimmed">Pick a niche and a platform.</Text>
      </Modal>
    );
  }

  const cost = estimateVideoCostUsd({
    scene_count: niche.scene_count,
    image_quality: niche.image_quality,
    video_resolution: niche.video_resolution,
    scene_max_duration_sec: niche.scene_max_duration_sec,
    target_duration_sec: niche.target_duration_sec,
  });
  const cap = Number(niche.daily_spend_cap_usd);
  const spent = Number(spentToday) || 0;
  const remaining = Math.max(0, cap - spent);
  const overBudget = cost.total > remaining;

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("niche_id", niche.id);
      fd.set("platform", platform);
      const result = await enqueueJobAction(EMPTY_STATE, fd);
      if (!result.ok) {
        const msg = result.error ?? "enqueue failed";
        setError(msg);
        notifications.show({
          title: "Could not enqueue",
          message: msg,
          color: "red",
        });
        return;
      }
      notifications.show({
        title: "Job enqueued",
        message: `${niche.title} → ${platform}. Track it in the queue.`,
        color: "green",
      });
      onClose();
    });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Confirm run" centered>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700}>{niche.title}</Text>
          <Badge color="indigo" variant="light">
            {platform}
          </Badge>
        </Group>

        <Divider />

        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Estimated cost
            </Text>
            <Text size="sm" fw={600}>
              {formatUsd(cost.total)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Spent today
            </Text>
            <Text size="sm">{formatUsd(spent)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Daily cap
            </Text>
            <Text size="sm">{formatUsd(cap)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Remaining today
            </Text>
            <Text size="sm" fw={600} c={overBudget ? "red" : undefined}>
              {formatUsd(remaining)}
            </Text>
          </Group>
        </Stack>

        {overBudget && (
          <Alert
            color="yellow"
            icon={<IconAlertCircle size={16} />}
            variant="light"
          >
            This run is estimated to exceed today's remaining budget. The
            backend will still enforce the cap and may abort partway.
          </Alert>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={isPending} color="indigo">
            Run now
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
