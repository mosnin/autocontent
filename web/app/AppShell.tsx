"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppShell,
  Burger,
  Group,
  Drawer,
  Stack,
  Button,
  Container,
  Box,
  Anchor,
  Text,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { SignedIn, SignedOut, UserButton, SignInButton } from "@clerk/nextjs";
import { IconSearch } from "@tabler/icons-react";

import { GlobalSpotlight, spotlight } from "./Spotlight";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/queue", label: "Queue" },
  { href: "/connect", label: "Connect" },
  { href: "/settings/tokens", label: "Settings" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname?.startsWith(href);
  };

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" wrap="nowrap">
              <Anchor
                component={Link}
                href="/"
                underline="never"
                fw={800}
                size="lg"
                c="indigo"
              >
                autocontent
              </Anchor>

              <SignedIn>
                <Group gap="xs" visibleFrom="sm">
                  {NAV_LINKS.map((link) => (
                    <Button
                      key={link.href}
                      component={Link}
                      href={link.href}
                      variant={isActive(link.href) ? "light" : "subtle"}
                      color="indigo"
                      size="sm"
                    >
                      {link.label}
                    </Button>
                  ))}
                </Group>
              </SignedIn>
            </Group>

            <Group gap="xs" wrap="nowrap">
              <SignedIn>
                <Tooltip label="Search (⌘K)" withArrow>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={() => spotlight.open()}
                    aria-label="Open command palette"
                  >
                    <IconSearch size={18} />
                  </ActionIcon>
                </Tooltip>
                <Box visibleFrom="sm">
                  <UserButton />
                </Box>
                <Burger
                  opened={drawerOpen}
                  onClick={() => setDrawerOpen((o) => !o)}
                  hiddenFrom="sm"
                  size="sm"
                  aria-label="Open navigation menu"
                />
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button size="sm" variant="filled" color="indigo">
                    Sign in
                  </Button>
                </SignInButton>
              </SignedOut>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <Drawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Menu"
        size="xs"
        hiddenFrom="sm"
      >
        <Stack gap="xs">
          {NAV_LINKS.map((link) => (
            <Button
              key={link.href}
              component={Link}
              href={link.href}
              variant={isActive(link.href) ? "light" : "subtle"}
              color="indigo"
              justify="flex-start"
              fullWidth
              onClick={() => setDrawerOpen(false)}
            >
              {link.label}
            </Button>
          ))}
          <Box mt="md">
            <Text size="xs" c="dimmed" mb={4}>
              Account
            </Text>
            <UserButton />
          </Box>
        </Stack>
      </Drawer>

      <AppShell.Main>
        <Container size="xl">{children}</Container>
      </AppShell.Main>

      <SignedIn>
        <GlobalSpotlight />
      </SignedIn>
    </AppShell>
  );
}
