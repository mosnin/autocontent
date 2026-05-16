import {
  Stack,
  Card,
  ThemeIcon,
  Title,
  Text,
  Button,
  Group,
  Badge,
  Code,
  Container,
  Center,
} from "@mantine/core";
import { IconPlugConnected, IconCheck } from "@tabler/icons-react";

import { api } from "../../lib/api";
import { connectAyrshareAction } from "../../lib/actions";
import type { AyrshareConnectStatus } from "../../lib/types";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

export default async function ConnectPage() {
  const status = await api<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status");
  const connected = Boolean(status.connected && status.profile_key);

  return (
    <Container size="sm" py="xl">
      <Center>
        <Card withBorder padding="xl" radius="md" w="100%">
          <Stack gap="md" align="center">
            <ThemeIcon
              size={72}
              radius="xl"
              color={connected ? "green" : "indigo"}
              variant="light"
            >
              {connected ? <IconCheck size={36} /> : <IconPlugConnected size={36} />}
            </ThemeIcon>
            <Title order={2} ta="center">
              Connect your socials
            </Title>
            <Text c="dimmed" ta="center" maw={420}>
              Scheduling posts requires an Ayrshare User Profile linked to your
              TikTok, Instagram and/or YouTube. We'll bounce you to Ayrshare's
              hosted chooser to authorize each.
            </Text>

            <Group justify="center">
              <Badge color={connected ? "green" : "gray"} variant="light">
                {connected ? "connected" : "not connected"}
              </Badge>
            </Group>

            {connected && status.profile_key && (
              <Stack gap={4} align="center">
                <Text size="xs" c="dimmed">
                  profile_key
                </Text>
                <Code>{maskKey(status.profile_key)}</Code>
              </Stack>
            )}

            <form action={connectAyrshareAction}>
              <Button type="submit" size="md" color="indigo">
                {connected ? "Reconnect / add accounts" : "Connect your socials"}
              </Button>
            </form>
          </Stack>
        </Card>
      </Center>
    </Container>
  );
}
