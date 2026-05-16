"use client";

import { useState, useTransition } from "react";
import {
  Stack,
  Group,
  Button,
  Modal,
  TextInput,
  NumberInput,
  Card,
  Title,
  Text,
  Table,
  Code,
  Alert,
  ActionIcon,
  CopyButton,
  Tooltip,
  Box,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconCopy,
  IconCheck,
  IconTrash,
  IconKey,
} from "@tabler/icons-react";

import {
  createTokenAction,
  revokeTokenAction,
  EMPTY_STATE,
} from "../../../lib/actions";
import type { PersonalAccessToken } from "../../../lib/types";

interface Props {
  tokens: PersonalAccessToken[];
  freshToken: string | null;
}

export function TokensClient({ tokens, freshToken }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<{ name: string; expires_in_days: number | "" }>({
    initialValues: { name: "", expires_in_days: "" },
    validate: {
      name: (v) => (v.trim() ? null : "Required"),
    },
  });

  const onCreate = () => {
    if (form.validate().hasErrors) return;
    setCreateError(null);
    const v = form.getValues();
    const fd = new FormData();
    fd.set("name", v.name);
    if (v.expires_in_days !== "" && v.expires_in_days != null) {
      fd.set("expires_in_days", String(v.expires_in_days));
    }
    startTransition(async () => {
      try {
        const res = await createTokenAction(EMPTY_STATE, fd);
        if (!res.ok && res.error) {
          setCreateError(res.error);
        }
        // Server action redirects on success — no manual handling needed.
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("NEXT_REDIRECT")) throw e;
        setCreateError(msg);
      }
    });
  };

  return (
    <Stack gap="md">
      {freshToken && (
        <Alert color="yellow" variant="light" title="New token — shown once">
          <Stack gap="xs">
            <Code block style={{ userSelect: "all" }}>
              {freshToken}
            </Code>
            <Group gap="xs">
              <CopyButton value={freshToken} timeout={2000}>
                {({ copied, copy }) => (
                  <Button
                    size="xs"
                    color={copied ? "teal" : "indigo"}
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    onClick={copy}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                )}
              </CopyButton>
              <Text size="xs" c="dimmed">
                Save into <code>AUTOCONTENT_API_TOKEN</code> — the plaintext
                isn't stored.
              </Text>
            </Group>
          </Stack>
        </Alert>
      )}

      <Group justify="space-between">
        <Title order={4}>Active tokens</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          color="indigo"
          onClick={() => setModalOpen(true)}
        >
          New token
        </Button>
      </Group>

      {tokens.length === 0 ? (
        <Card withBorder padding="lg">
          <Stack gap="xs" align="center">
            <IconKey size={32} stroke={1.5} color="var(--mantine-color-gray-6)" />
            <Text c="dimmed">No tokens yet.</Text>
          </Stack>
        </Card>
      ) : (
        <Box style={{ overflowX: "auto" }}>
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Prefix</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Expires</Table.Th>
                <Table.Th>Last used</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tokens.map((t) => (
                <TokenRow key={t.id} token={t} />
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCreateError(null);
          form.reset();
        }}
        title="Create token"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            description="For your reference"
            placeholder="e.g. laptop-cli"
            required
            key={form.key("name")}
            {...form.getInputProps("name")}
          />
          <NumberInput
            label="Expires in days"
            description="Leave blank for non-expiring"
            min={1}
            max={3650}
            allowDecimal={false}
            key={form.key("expires_in_days")}
            {...form.getInputProps("expires_in_days")}
          />
          {createError && (
            <Alert color="red" variant="light">
              {createError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setModalOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={onCreate} loading={isPending} color="indigo">
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function TokenRow({ token }: { token: PersonalAccessToken }) {
  const [isPending, startTransition] = useTransition();
  const onRevoke = () => {
    if (!confirm(`Revoke "${token.name}"? Anything using it will stop working.`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token_id", token.id);
      const res = await revokeTokenAction(EMPTY_STATE, fd);
      if (!res.ok) {
        notifications.show({
          title: "Revoke failed",
          message: res.error ?? "Try again",
          color: "red",
        });
        return;
      }
      notifications.show({
        title: "Token revoked",
        message: token.name,
        color: "green",
      });
    });
  };

  return (
    <Table.Tr>
      <Table.Td>{token.name}</Table.Td>
      <Table.Td>
        <Code>{token.prefix}</Code>
      </Table.Td>
      <Table.Td>
        <Text size="xs">{new Date(token.created_at).toLocaleString()}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">
          {token.expires_at ? new Date(token.expires_at).toLocaleString() : "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">
          {token.last_used_at
            ? new Date(token.last_used_at).toLocaleString()
            : "never"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Tooltip label="Revoke">
          <ActionIcon
            color="red"
            variant="subtle"
            onClick={onRevoke}
            loading={isPending}
            aria-label="Revoke token"
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  );
}
