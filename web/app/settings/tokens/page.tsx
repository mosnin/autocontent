import { Container, Stack, Title, Text } from "@mantine/core";

import { api } from "../../../lib/api";
import type { PersonalAccessToken } from "../../../lib/types";
import { TokensClient } from "./TokensClient";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ just_created?: string }>;
}

export default async function TokensPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tokens = await api<PersonalAccessToken[]>("/api/v1/tokens");
  const freshToken = sp.just_created ?? null;

  return (
    <Container size="md" py="md">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={2}>Personal access tokens</Title>
          <Text c="dimmed">
            Tokens authenticate the CLI, the MCP server, and any external agent
            driving autocontent. They start with <code>act_</code> and can do
            anything your account can. Treat them like passwords.
          </Text>
        </Stack>
        <TokensClient tokens={tokens} freshToken={freshToken} />
      </Stack>
    </Container>
  );
}
