import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import {
  Stack,
  Title,
  Text,
  Button,
  Group,
  SimpleGrid,
  Card,
  ThemeIcon,
  Box,
} from "@mantine/core";
import {
  IconBolt,
  IconCoin,
  IconTerminal2,
} from "@tabler/icons-react";

const FEATURES = [
  {
    icon: IconBolt,
    title: "Autonomous niches",
    body: "Spin up a channel; we ideate, script, generate, render and schedule on a cadence you set.",
  },
  {
    icon: IconCoin,
    title: "Spend-capped runs",
    body: "Per-niche daily ceiling in USD — the pipeline self-throttles when the budget is hit.",
  },
  {
    icon: IconTerminal2,
    title: "MCP + CLI for agents",
    body: "Personal access tokens let Claude, agents and shell scripts drive the same surface as the web UI.",
  },
];

export default function Home() {
  return (
    <Stack gap="xl" py="xl">
      <Box ta="center" py="xl">
        <Title order={1} fz={{ base: 36, sm: 56 }} fw={800} mb="md">
          autocontent
        </Title>
        <Text size="xl" c="dimmed" maw={620} mx="auto" mb="xl">
          Autonomous short-form content for your niches — scripted, rendered
          and scheduled on autopilot.
        </Text>
        <Group justify="center">
          <SignedIn>
            <Button component={Link} href="/dashboard" size="lg" color="indigo">
              Open dashboard
            </Button>
          </SignedIn>
          <SignedOut>
            <Button component={Link} href="/sign-in" size="lg" color="indigo">
              Get started
            </Button>
          </SignedOut>
        </Group>
      </Box>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        {FEATURES.map((f) => (
          <Card key={f.title} withBorder padding="lg" radius="md">
            <ThemeIcon variant="light" color="indigo" size={42} radius="md" mb="sm">
              <f.icon size={22} />
            </ThemeIcon>
            <Text fw={700} mb={4}>
              {f.title}
            </Text>
            <Text size="sm" c="dimmed">
              {f.body}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
