import Link from "next/link";
import { Stack, Title, Text, Alert, Container } from "@mantine/core";
import { IconPlugConnectedX } from "@tabler/icons-react";

import { OnboardingForm } from "./OnboardingForm";

export default function Onboarding() {
  return (
    <Container size="md" py="md">
      <Stack gap="md">
        <Alert
          color="yellow"
          variant="light"
          icon={<IconPlugConnectedX size={18} />}
          title="Posting requires Ayrshare"
        >
          Schedule posts require Ayrshare connected.{" "}
          <Link href="/connect" style={{ textDecoration: "underline" }}>
            Connect now
          </Link>
          .
        </Alert>

        <Stack gap={4}>
          <Title order={2}>Add a niche</Title>
          <Text c="dimmed">
            The pipeline uses these to drive ideation, visuals, voice,
            scheduling, and the daily spend ceiling.
          </Text>
        </Stack>

        <OnboardingForm />
      </Stack>
    </Container>
  );
}
