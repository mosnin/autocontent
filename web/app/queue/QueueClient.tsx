"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Stack,
  Title,
  Tabs,
  Table,
  Group,
  Text,
  Loader,
  Button,
  Alert,
  Code,
  Center,
  ThemeIcon,
  Box,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconList, IconRefresh } from "@tabler/icons-react";

import { EMPTY_STATE, retryJobAction } from "../../lib/actions";
import { clientFetch } from "../../lib/client-fetcher";
import type { Job, JobStatus } from "../../lib/types";
import { StatusBadge } from "../components/StatusBadge";

const IN_PROGRESS_STATUSES: JobStatus[] = [
  "queued",
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
];

const POLL_MS = 5000;

type FilterKey = "all" | "in_progress" | "done" | "failed";

function matchesFilter(job: Job, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "done") return job.status === "done";
  if (filter === "failed") return job.status === "failed";
  return IN_PROGRESS_STATUSES.includes(job.status);
}

export function QueueClient({ initial }: { initial: Job[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data, error } = useSWR<Job[]>("/api/v1/jobs?limit=100", clientFetch, {
    refreshInterval: POLL_MS,
    fallbackData: initial,
  });

  const jobs = data ?? [];
  const filtered = useMemo(() => jobs.filter((j) => matchesFilter(j, filter)), [jobs, filter]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: jobs.length, in_progress: 0, done: 0, failed: 0 };
    for (const j of jobs) {
      if (j.status === "done") c.done++;
      else if (j.status === "failed") c.failed++;
      else if (IN_PROGRESS_STATUSES.includes(j.status)) c.in_progress++;
    }
    return c;
  }, [jobs]);

  return (
    <Stack gap="md" py="md">
      <Title order={2}>Queue</Title>

      {error && (
        <Alert color="red" variant="light" title="Live updates paused">
          {error.message ?? "fetch failed"}
        </Alert>
      )}

      <Tabs value={filter} onChange={(v) => setFilter((v as FilterKey) ?? "all")}>
        <Tabs.List>
          <Tabs.Tab value="all">All ({counts.all})</Tabs.Tab>
          <Tabs.Tab value="in_progress">In progress ({counts.in_progress})</Tabs.Tab>
          <Tabs.Tab value="done">Done ({counts.done})</Tabs.Tab>
          <Tabs.Tab value="failed">Failed ({counts.failed})</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyQueue />
      ) : (
        <Box style={{ overflowX: "auto" }}>
          <Table striped highlightOnHover withTableBorder verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Job</Table.Th>
                <Table.Th>Platform</Table.Th>
                <Table.Th>Hook</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Scheduled</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((job) => (
                <Table.Tr
                  key={job.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/queue/${job.id}`)}
                >
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <StatusBadge status={job.status} />
                      {IN_PROGRESS_STATUSES.includes(job.status) && (
                        <Loader size="xs" />
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Code>{job.id.slice(0, 8)}</Code>
                  </Table.Td>
                  <Table.Td>{job.platform}</Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1} maw={280}>
                      {job.script?.idea?.hook ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {new Date(job.created_at).toLocaleString()}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {job.scheduled_for
                        ? new Date(job.scheduled_for).toLocaleString()
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {job.status === "failed" && <RetryButton jobId={job.id} />}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}

function RetryButton({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("job_id", jobId);
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
        message: `Retrying ${jobId.slice(0, 8)}…`,
        color: "green",
      });
    });
  };
  return (
    <Button
      size="xs"
      color="red"
      variant="light"
      leftSection={<IconRefresh size={12} />}
      loading={isPending}
      onClick={onClick}
    >
      Retry
    </Button>
  );
}

function EmptyQueue() {
  return (
    <Center py={60}>
      <Stack gap="sm" align="center" maw={400}>
        <ThemeIcon size={48} radius="xl" color="gray" variant="light">
          <IconList size={24} />
        </ThemeIcon>
        <Text fw={600}>No jobs in this view</Text>
        <Text size="sm" c="dimmed" ta="center">
          Trigger one from the dashboard's "Run now" button.
        </Text>
      </Stack>
    </Center>
  );
}
