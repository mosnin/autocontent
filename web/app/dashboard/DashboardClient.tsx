"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  Alert,
  Card,
  Badge,
  Progress,
  Tooltip,
  Menu,
  ActionIcon,
  SimpleGrid,
  ThemeIcon,
  Center,
  Box,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconDotsVertical,
  IconArchive,
  IconEdit,
  IconAlertTriangle,
  IconPlayerPlay,
  IconSparkles,
} from "@tabler/icons-react";

import {
  archiveNicheAction,
  EMPTY_STATE,
} from "../../lib/actions";
import { clientFetch } from "../../lib/client-fetcher";
import { formatUsd } from "../../lib/format";
import type { Niche, Platform, TodaySpend } from "../../lib/types";
import { RunConfirmModal } from "./RunConfirmModal";

interface InitialData {
  niches: Niche[];
  spend: TodaySpend;
  ayrshareConnected: boolean | null;
}

const POLL_MS = 5000;

export function DashboardClient({ initial }: { initial: InitialData }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const { data: niches, error: nichesError } = useSWR<Niche[]>(
    "/api/v1/niches",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.niches },
  );
  const { data: spend, error: spendError } = useSWR<TodaySpend>(
    "/api/v1/spend/today",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.spend },
  );
  const { data: ayrshare } = useSWR<{ connected: boolean }>(
    initial.ayrshareConnected === null ? null : "/api/v1/connect/ayrshare/status",
    clientFetch,
    {
      refreshInterval: POLL_MS,
      fallbackData:
        initial.ayrshareConnected === null
          ? undefined
          : { connected: initial.ayrshareConnected },
      shouldRetryOnError: false,
    },
  );

  const nichesList = niches ?? [];
  const spendData = spend ?? { by_niche: {}, total_usd: "0" };
  const showAyrshareBanner =
    ayrshare !== undefined && ayrshare.connected === false;

  // Modal state. Shared so the spotlight "Enqueue {niche}" action can
  // open it via the ?run=<niche_id> query param.
  const [modalNiche, setModalNiche] = useState<Niche | null>(null);
  const [modalPlatform, setModalPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    const runId = searchParams.get("run");
    if (!runId) return;
    const target = nichesList.find((n) => n.id === runId);
    if (target && target.platforms.length > 0) {
      setModalNiche(target);
      setModalPlatform(target.platforms[0]);
      // Clear the query param without reloading
      router.replace("/dashboard", { scroll: false });
    }
  }, [searchParams, nichesList, router]);

  const openRunModal = (n: Niche, p: Platform) => {
    setModalNiche(n);
    setModalPlatform(p);
  };

  const closeRunModal = () => {
    setModalNiche(null);
    setModalPlatform(null);
  };

  return (
    <Stack gap="md" py="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Niches</Title>
        <Group gap="md">
          <Text c="dimmed" size="sm">
            Today's spend:{" "}
            <Text component="span" fw={700} c="indigo">
              {formatUsd(spendData.total_usd)}
            </Text>
          </Text>
          <Button
            component={Link}
            href="/onboarding"
            leftSection={<IconPlus size={16} />}
            color="indigo"
          >
            Add niche
          </Button>
        </Group>
      </Group>

      {showAyrshareBanner && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title="Ayrshare not connected"
        >
          Your Ayrshare profile isn't connected — generated posts won't ship
          until you finish that setup.{" "}
          <Anchor href="/connect">Connect now</Anchor>.
        </Alert>
      )}

      {(nichesError || spendError) && (
        <Alert color="red" variant="light" title="Live updates paused">
          {(nichesError ?? spendError)?.message ?? "fetch failed"}
        </Alert>
      )}

      {nichesList.length === 0 ? (
        <EmptyNiches />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {nichesList.map((n) => (
            <NicheCard
              key={n.id}
              niche={n}
              spentToday={spendData.by_niche[n.id] ?? "0"}
              onRun={openRunModal}
            />
          ))}
        </SimpleGrid>
      )}

      <RunConfirmModal
        opened={modalNiche !== null}
        onClose={closeRunModal}
        niche={modalNiche}
        platform={modalPlatform}
        spentToday={
          modalNiche ? spendData.by_niche[modalNiche.id] ?? "0" : "0"
        }
      />
    </Stack>
  );
}

// Local Anchor wrapper so we don't need to import the full one.
function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ textDecoration: "underline" }}>
      {children}
    </Link>
  );
}

interface NicheCardProps {
  niche: Niche;
  spentToday: string;
  onRun: (niche: Niche, platform: Platform) => void;
}

function NicheCard({ niche, spentToday, onRun }: NicheCardProps) {
  const cap = Number(niche.daily_spend_cap_usd);
  const spent = Number(spentToday);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  const [isArchiving, startArchive] = useTransition();

  const onArchive = () => {
    if (!confirm(`Archive niche "${niche.title}"? This stops new posts.`)) {
      return;
    }
    startArchive(async () => {
      const fd = new FormData();
      fd.set("niche_id", niche.id);
      const res = await archiveNicheAction(EMPTY_STATE, fd);
      if (!res.ok) {
        notifications.show({
          title: "Archive failed",
          message: res.error ?? "Try again",
          color: "red",
        });
        return;
      }
      notifications.show({
        title: "Niche archived",
        message: niche.title,
        color: "green",
      });
    });
  };

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Title order={4} lineClamp={1}>
            {niche.title}
          </Title>
          <Menu shadow="md" position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Niche actions">
                <IconDotsVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconEdit size={14} />}
                disabled
                title="Editing coming soon"
              >
                Edit
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconArchive size={14} />}
                onClick={onArchive}
                disabled={isArchiving}
              >
                {isArchiving ? "Archiving…" : "Archive"}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        <Text size="sm" c="dimmed" lineClamp={2}>
          {niche.description}
        </Text>

        <Text size="xs" c="dimmed">
          Audience: {niche.target_audience}
        </Text>

        {niche.hashtags.length > 0 && (
          <Group gap={4} wrap="wrap">
            {niche.hashtags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="light" color="gray" size="sm">
                #{tag}
              </Badge>
            ))}
          </Group>
        )}

        <Group gap="md" wrap="wrap" mt={4}>
          <Tooltip label="Image quality">
            <Text size="xs" c="dimmed">
              quality: <b>{niche.image_quality}</b>
            </Text>
          </Tooltip>
          <Tooltip label="Video resolution">
            <Text size="xs" c="dimmed">
              res: <b>{niche.video_resolution}</b>
            </Text>
          </Tooltip>
          <Tooltip label="Scenes per video">
            <Text size="xs" c="dimmed">
              scenes: <b>{niche.scene_count}</b>
            </Text>
          </Tooltip>
        </Group>

        <Tooltip label={`${formatUsd(spent)} of ${formatUsd(cap)}`} withArrow>
          <Box>
            <Progress
              value={pct}
              color={pct >= 100 ? "red" : pct >= 80 ? "yellow" : "indigo"}
              size="sm"
              radius="sm"
            />
            <Text size="xs" c="dimmed" mt={4}>
              {formatUsd(spent)} / {formatUsd(cap)} today
            </Text>
          </Box>
        </Tooltip>

        <Group gap="xs" wrap="wrap" mt="xs">
          {niche.platforms.map((platform) => (
            <Button
              key={platform}
              size="xs"
              variant="light"
              color="indigo"
              leftSection={<IconPlayerPlay size={12} />}
              onClick={() => onRun(niche, platform)}
            >
              Run {platform}
            </Button>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}

function EmptyNiches() {
  return (
    <Center py={80}>
      <Stack gap="md" align="center" maw={400}>
        <ThemeIcon size={64} radius="xl" color="indigo" variant="light">
          <IconSparkles size={32} />
        </ThemeIcon>
        <Title order={3}>No niches yet</Title>
        <Text c="dimmed" ta="center">
          Niches drive ideation, visuals, voice, scheduling, and the daily
          spend ceiling. Create one to get the pipeline rolling.
        </Text>
        <Button
          component={Link}
          href="/onboarding"
          leftSection={<IconPlus size={16} />}
          color="indigo"
          size="md"
        >
          Create your first niche
        </Button>
      </Stack>
    </Center>
  );
}
