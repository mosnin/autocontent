"use client";

import { useTransition } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Stack,
  Group,
  Title,
  Text,
  Card,
  Tabs,
  Skeleton,
  SimpleGrid,
  Button,
  Code,
  Badge,
  Loader,
  Divider,
  Box,
  Alert,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconRefresh,
  IconExternalLink,
} from "@tabler/icons-react";

import { EMPTY_STATE, retryJobAction } from "../../../lib/actions";
import { clientFetch } from "../../../lib/client-fetcher";
import { estimateVideoCostUsd } from "../../../lib/cost-estimator";
import { formatUsd } from "../../../lib/format";
import type { Job, ImageQuality, VideoResolution } from "../../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";

const POLL_MS = 5000;

// Best-effort lookup of script-shaped fields. The backend stores the
// full pipeline payload on the job row, but the TS Job type only models
// what's stable (`script.idea.hook`). Anything richer goes through a
// loose record cast.
interface LooseScene {
  narration?: string;
  motion_prompt?: string;
  duration_sec?: number;
}
interface LooseScript {
  idea?: { hook?: string; topic?: string };
  scenes?: LooseScene[];
}
type LooseJob = Omit<Job, "script"> & {
  script?: LooseScript | null;
  payload?: {
    scene_count?: number;
    image_quality?: ImageQuality;
    video_resolution?: VideoResolution;
    scene_max_duration_sec?: number;
    target_duration_sec?: number;
  } | null;
};

export function JobDetailClient({ initial }: { initial: Job }) {
  const { data } = useSWR<Job>(`/api/v1/jobs/${initial.id}`, clientFetch, {
    refreshInterval: POLL_MS,
    fallbackData: initial,
  });
  const job: LooseJob = (data ?? initial) as LooseJob;

  const [isRetrying, startRetry] = useTransition();
  const onRetry = () => {
    startRetry(async () => {
      const fd = new FormData();
      fd.set("job_id", job.id);
      const res = await retryJobAction(EMPTY_STATE, fd);
      if (!res.ok) {
        notifications.show({
          title: "Retry failed",
          message: res.error ?? "Try again",
          color: "red",
        });
        return;
      }
      notifications.show({
        title: "Job re-queued",
        message: `Retrying ${job.id.slice(0, 8)}…`,
        color: "green",
      });
    });
  };

  const hasRendered = Boolean(job.rendered?.path);

  return (
    <Stack gap="md" py="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <Button
            component={Link}
            href="/queue"
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            size="xs"
          >
            Back to queue
          </Button>
        </Group>
        <Group gap="xs">
          {job.status === "failed" && (
            <Button
              color="red"
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={onRetry}
              loading={isRetrying}
            >
              Retry
            </Button>
          )}
          {job.provider_post_id && (
            <Button
              component="a"
              // TODO(autocontent): Ayrshare doesn't publicly document a
              // direct deep-link URL pattern; the dashboard link is the
              // safest default.
              href="https://app.ayrshare.com/posts"
              target="_blank"
              rel="noreferrer"
              variant="light"
              rightSection={<IconExternalLink size={14} />}
            >
              Open on Ayrshare
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder padding="md" radius="md">
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm" wrap="wrap">
            <StatusBadge status={job.status} />
            <Code>{job.id}</Code>
            <Badge variant="light" color="indigo">
              {job.platform}
            </Badge>
          </Group>
          <Group gap="lg" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">
                Created
              </Text>
              <Text size="sm">{new Date(job.created_at).toLocaleString()}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Scheduled
              </Text>
              <Text size="sm">
                {job.scheduled_for
                  ? new Date(job.scheduled_for).toLocaleString()
                  : "—"}
              </Text>
            </Box>
          </Group>
        </Group>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder padding="md" radius="md">
          <Title order={5} mb="sm">
            Preview
          </Title>
          {hasRendered ? (
            <video
              controls
              style={{
                width: "100%",
                maxHeight: 480,
                borderRadius: 8,
                background: "var(--mantine-color-dark-9)",
              }}
              src={`/api/proxy/api/v1/jobs/${job.id}/video`}
            />
          ) : (
            <Stack gap="sm" align="center" py="md">
              <Skeleton h={240} w="100%" radius="md" />
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Render in progress
                </Text>
              </Group>
            </Stack>
          )}
        </Card>

        <Card withBorder padding="md" radius="md">
          <Tabs defaultValue="script">
            <Tabs.List>
              <Tabs.Tab value="script">Script</Tabs.Tab>
              <Tabs.Tab value="scenes">Scenes</Tabs.Tab>
              <Tabs.Tab value="costs">Costs</Tabs.Tab>
              <Tabs.Tab value="logs">Logs</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="script" pt="md">
              <ScriptPanel job={job} />
            </Tabs.Panel>

            <Tabs.Panel value="scenes" pt="md">
              <ScenesPanel job={job} />
            </Tabs.Panel>

            <Tabs.Panel value="costs" pt="md">
              <CostsPanel job={job} />
            </Tabs.Panel>

            <Tabs.Panel value="logs" pt="md">
              <LogsPanel job={job} />
            </Tabs.Panel>
          </Tabs>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

function ScriptPanel({ job }: { job: LooseJob }) {
  const idea = job.script?.idea;
  const scenes = job.script?.scenes ?? [];
  if (!idea && scenes.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Script not yet generated.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {idea?.hook && (
        <Box>
          <Text size="xs" c="dimmed">
            Hook
          </Text>
          <Text fw={600}>{idea.hook}</Text>
        </Box>
      )}
      {idea?.topic && (
        <Box>
          <Text size="xs" c="dimmed">
            Topic
          </Text>
          <Text size="sm">{idea.topic}</Text>
        </Box>
      )}
      {scenes.length > 0 && <Divider my="xs" />}
      {scenes.map((s, idx) => (
        <Box key={idx}>
          <Text size="xs" c="dimmed">
            Scene {idx + 1}
          </Text>
          <Text size="sm">{s.narration ?? "(no narration)"}</Text>
        </Box>
      ))}
    </Stack>
  );
}

function ScenesPanel({ job }: { job: LooseJob }) {
  const scenes = job.script?.scenes ?? [];
  if (scenes.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Scenes not yet generated.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {scenes.map((s, idx) => (
        <Card key={idx} withBorder padding="sm" radius="sm">
          <Group justify="space-between" wrap="wrap">
            <Text size="sm" fw={600}>
              Scene {idx + 1}
            </Text>
            {s.duration_sec !== undefined && (
              <Badge variant="light">{s.duration_sec}s</Badge>
            )}
          </Group>
          {s.motion_prompt && (
            <Text size="xs" c="dimmed" mt={4}>
              motion: {s.motion_prompt}
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  );
}

function CostsPanel({ job }: { job: LooseJob }) {
  // We don't have the per-call ledger surfaced on the Job model. Fall
  // back to the estimator using the niche's settings if they're on the
  // payload; otherwise show a "best estimate" caveat.
  const inputs = {
    scene_count: job.payload?.scene_count ?? job.script?.scenes?.length ?? 6,
    image_quality: job.payload?.image_quality ?? "medium",
    video_resolution: job.payload?.video_resolution ?? "480p",
    scene_max_duration_sec: job.payload?.scene_max_duration_sec ?? 5,
    target_duration_sec: job.payload?.target_duration_sec ?? 60,
  };
  const breakdown = estimateVideoCostUsd(inputs);
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">
        Estimate — the authoritative per-call ledger lives on the backend.
      </Text>
      <Group justify="space-between">
        <Text size="sm">Images ({inputs.scene_count} scenes)</Text>
        <Text size="sm" fw={500}>
          {formatUsd(breakdown.image)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="sm">Video clips</Text>
        <Text size="sm" fw={500}>
          {formatUsd(breakdown.video)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="sm">TTS</Text>
        <Text size="sm" fw={500}>
          {formatUsd(breakdown.tts)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="sm">Whisper</Text>
        <Text size="sm" fw={500}>
          {formatUsd(breakdown.whisper)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Character sheet (one-time)
        </Text>
        <Text size="sm" c="dimmed">
          {formatUsd(breakdown.character_sheet)}
        </Text>
      </Group>
      <Divider my={4} />
      <Group justify="space-between">
        <Text size="sm" fw={700}>
          Estimated total
        </Text>
        <Text size="sm" fw={700}>
          {formatUsd(breakdown.total)}
        </Text>
      </Group>
    </Stack>
  );
}

function LogsPanel({ job }: { job: LooseJob }) {
  if (!job.error) {
    return (
      <Text size="sm" c="dimmed">
        No errors.
      </Text>
    );
  }
  return (
    <Alert color="red" variant="light" title="Pipeline error">
      <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {job.error}
      </Code>
    </Alert>
  );
}

