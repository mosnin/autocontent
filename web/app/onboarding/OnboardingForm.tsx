"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Stepper,
  Stack,
  Group,
  TextInput,
  Textarea,
  Select,
  SegmentedControl,
  TagsInput,
  MultiSelect,
  Button,
  NumberInput,
  Card,
  Title,
  Text,
  Alert,
  Chip,
  Divider,
} from "@mantine/core";
import { useForm } from "@mantine/form";

import { createNicheAction, EMPTY_STATE } from "../../lib/actions";
import { estimateVideoCostUsd } from "../../lib/cost-estimator";
import { formatUsd } from "../../lib/format";
import {
  PLATFORMS,
  QUALITIES,
  RESOLUTIONS,
  type ImageQuality,
  type Platform,
  type VideoResolution,
} from "../../lib/types";

const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "sage", "coral"];

const VISUAL_STYLE_EXAMPLES = [
  "claymation econ teacher",
  "horror short narrator",
  "70s film grain",
];

interface FormValues {
  title: string;
  description: string;
  target_audience: string;
  hashtags: string[];
  visual_style: string;
  voice: string;
  target_duration_sec: number;
  scene_count: number;
  image_quality: ImageQuality;
  video_resolution: VideoResolution;
  scene_max_duration_sec: number;
  tts_style_directions: string;
  posting_hour: number;
  posting_minute: number;
  tz: string;
  platforms: Platform[];
  daily_spend_cap_usd: number;
}

const defaultTz =
  typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
    : "America/Los_Angeles";

export function OnboardingForm() {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    mode: "uncontrolled",
    initialValues: {
      title: "",
      description: "",
      target_audience: "",
      hashtags: [],
      visual_style: "",
      voice: "onyx",
      target_duration_sec: 60,
      scene_count: 6,
      image_quality: "medium",
      video_resolution: "480p",
      scene_max_duration_sec: 5,
      tts_style_directions: "",
      posting_hour: 9,
      posting_minute: 0,
      tz: defaultTz,
      platforms: [],
      daily_spend_cap_usd: 5,
    },
    validate: (values) => {
      const errors: Record<string, string> = {};
      if (active === 0) {
        if (!values.title.trim()) errors.title = "Required";
        if (!values.description.trim()) errors.description = "Required";
        if (!values.target_audience.trim()) errors.target_audience = "Required";
      }
      if (active === 1) {
        if (!values.visual_style.trim()) errors.visual_style = "Required";
        if (values.scene_count < 2 || values.scene_count > 12)
          errors.scene_count = "Between 2 and 12";
        if (values.target_duration_sec < 15 || values.target_duration_sec > 90)
          errors.target_duration_sec = "Between 15 and 90 seconds";
        if (values.scene_max_duration_sec < 1 || values.scene_max_duration_sec > 15)
          errors.scene_max_duration_sec = "Between 1 and 15 seconds";
      }
      if (active === 2) {
        if (values.platforms.length === 0)
          errors.platforms = "Pick at least one platform";
        if (values.posting_hour < 0 || values.posting_hour > 23)
          errors.posting_hour = "0–23";
        if (values.posting_minute < 0 || values.posting_minute > 59)
          errors.posting_minute = "0–59";
        if (values.daily_spend_cap_usd < 0.5)
          errors.daily_spend_cap_usd = "Minimum $0.50";
      }
      return errors;
    },
  });

  const values = form.getValues();

  const cost = useMemo(
    () =>
      estimateVideoCostUsd({
        scene_count: values.scene_count,
        image_quality: values.image_quality,
        video_resolution: values.video_resolution,
        scene_max_duration_sec: values.scene_max_duration_sec,
        target_duration_sec: values.target_duration_sec,
      }),
    [
      values.scene_count,
      values.image_quality,
      values.video_resolution,
      values.scene_max_duration_sec,
      values.target_duration_sec,
    ],
  );

  const videosPerDay = cost.total > 0 ? Math.floor(values.daily_spend_cap_usd / cost.total) : 0;

  const next = () => {
    if (form.validate().hasErrors) return;
    setActive((s) => Math.min(2, s + 1));
  };
  const prev = () => setActive((s) => Math.max(0, s - 1));

  const submit = () => {
    if (form.validate().hasErrors) return;
    setSubmitError(null);
    const v = form.getValues();
    const fd = new FormData();
    fd.set("title", v.title);
    fd.set("description", v.description);
    fd.set("target_audience", v.target_audience);
    fd.set("hashtags", v.hashtags.join(","));
    fd.set("visual_style", v.visual_style);
    fd.set("voice", v.voice);
    fd.set("target_duration_sec", String(v.target_duration_sec));
    fd.set("scene_count", String(v.scene_count));
    fd.set("image_quality", v.image_quality);
    fd.set("video_resolution", v.video_resolution);
    fd.set("scene_max_duration_sec", String(v.scene_max_duration_sec));
    fd.set("tts_style_directions", v.tts_style_directions);
    fd.set("posting_hour", String(v.posting_hour));
    fd.set("posting_minute", String(v.posting_minute));
    fd.set("tz", v.tz);
    fd.set("daily_spend_cap_usd", String(v.daily_spend_cap_usd));
    for (const p of v.platforms) fd.append("platforms", p);

    startTransition(async () => {
      // The server action redirects on success, which surfaces as a
      // thrown NEXT_REDIRECT error inside the transition; that's fine.
      try {
        const res = await createNicheAction(EMPTY_STATE, fd);
        if (!res.ok && res.error) {
          setSubmitError(res.error);
          return;
        }
        // Defensive: if no redirect occurred (shouldn't happen on
        // success), push manually.
        router.push("/dashboard");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("NEXT_REDIRECT")) {
          // Server action redirected; let Next finish the flow.
          throw e;
        }
        setSubmitError(msg);
      }
    });
  };

  return (
    <Stack gap="lg">
      <Stepper
        active={active}
        onStepClick={setActive}
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="Identity" description="What is this channel?">
          <Stack gap="md" mt="md">
            <TextInput
              label="Title"
              description="Channel / niche name"
              required
              key={form.key("title")}
              {...form.getInputProps("title")}
            />
            <Textarea
              label="Description"
              description="What this channel is about"
              autosize
              minRows={3}
              required
              key={form.key("description")}
              {...form.getInputProps("description")}
            />
            <TextInput
              label="Target audience"
              required
              key={form.key("target_audience")}
              {...form.getInputProps("target_audience")}
            />
            <TagsInput
              label="Hashtags"
              description="Press enter to add, no # needed"
              placeholder="econ, macro, fed"
              key={form.key("hashtags")}
              {...form.getInputProps("hashtags")}
            />
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Creative" description="Look and feel">
          <Stack gap="md" mt="md">
            <Stack gap={4}>
              <Textarea
                label="Visual style"
                description="Passed verbatim to the visual director"
                autosize
                minRows={3}
                required
                placeholder="soft 3D claymation, pastel palette, shallow DOF"
                key={form.key("visual_style")}
                {...form.getInputProps("visual_style")}
              />
              <Group gap={6}>
                <Text size="xs" c="dimmed">
                  Try:
                </Text>
                {VISUAL_STYLE_EXAMPLES.map((ex) => (
                  <Chip
                    key={ex}
                    size="xs"
                    onClick={() => form.setFieldValue("visual_style", ex)}
                    checked={false}
                  >
                    {ex}
                  </Chip>
                ))}
              </Group>
            </Stack>

            <Group grow>
              <Select
                label="Voice"
                description="OpenAI TTS voice id"
                data={VOICES}
                key={form.key("voice")}
                {...form.getInputProps("voice")}
              />
              <NumberInput
                label="Target duration (sec)"
                min={15}
                max={90}
                required
                key={form.key("target_duration_sec")}
                {...form.getInputProps("target_duration_sec")}
              />
              <NumberInput
                label="Scene count"
                min={2}
                max={12}
                required
                key={form.key("scene_count")}
                {...form.getInputProps("scene_count")}
              />
            </Group>

            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Image quality
              </Text>
              <SegmentedControl
                data={QUALITIES.map((q) => ({ value: q, label: q }))}
                key={form.key("image_quality")}
                {...form.getInputProps("image_quality")}
              />
            </Stack>

            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Video resolution
              </Text>
              <SegmentedControl
                data={RESOLUTIONS.map((r) => ({ value: r, label: r }))}
                key={form.key("video_resolution")}
                {...form.getInputProps("video_resolution")}
              />
            </Stack>

            <NumberInput
              label="Max scene duration (sec)"
              min={1}
              max={15}
              required
              key={form.key("scene_max_duration_sec")}
              {...form.getInputProps("scene_max_duration_sec")}
            />

            <TextInput
              label="TTS style directions"
              description="Optional — passed verbatim to gpt-4o-mini-tts"
              placeholder="calm, conspiratorial narrator with deliberate pauses"
              key={form.key("tts_style_directions")}
              {...form.getInputProps("tts_style_directions")}
            />

            <Card withBorder padding="sm" radius="md" bg="var(--mantine-color-indigo-light)">
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  Estimated cost per video
                </Text>
                <Text size="lg" fw={700} c="indigo">
                  {formatUsd(cost.total)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Images {formatUsd(cost.image)} · Video {formatUsd(cost.video)} ·
                TTS {formatUsd(cost.tts)} · Whisper {formatUsd(cost.whisper)} ·
                Character sheet (one-time) {formatUsd(cost.character_sheet)}
              </Text>
            </Card>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Schedule" description="When and how much">
          <Stack gap="md" mt="md">
            <Group grow>
              <NumberInput
                label="Posting hour (0–23)"
                min={0}
                max={23}
                required
                key={form.key("posting_hour")}
                {...form.getInputProps("posting_hour")}
              />
              <NumberInput
                label="Posting minute (0–59)"
                min={0}
                max={59}
                required
                key={form.key("posting_minute")}
                {...form.getInputProps("posting_minute")}
              />
              <TextInput
                label="Timezone (IANA)"
                required
                key={form.key("tz")}
                {...form.getInputProps("tz")}
              />
            </Group>

            <MultiSelect
              label="Platforms"
              description="Where to publish each generated video"
              data={PLATFORMS.map((p) => ({ value: p, label: p }))}
              required
              key={form.key("platforms")}
              {...form.getInputProps("platforms")}
            />

            <NumberInput
              label="Daily spend cap (USD)"
              decimalScale={2}
              min={0.5}
              required
              key={form.key("daily_spend_cap_usd")}
              {...form.getInputProps("daily_spend_cap_usd")}
            />

            <Card withBorder padding="sm" radius="md">
              <Group justify="space-between">
                <Text size="sm">At current settings, your cap covers</Text>
                <Text size="sm" fw={700}>
                  ≈ {videosPerDay} video{videosPerDay === 1 ? "" : "s"}/day
                </Text>
              </Group>
              <Divider my={6} />
              <Text size="xs" c="dimmed">
                Cap of {formatUsd(values.daily_spend_cap_usd)} ÷{" "}
                {formatUsd(cost.total)} per video.
              </Text>
            </Card>
          </Stack>
        </Stepper.Step>
      </Stepper>

      {submitError && (
        <Alert color="red" variant="light" title="Could not create niche">
          {submitError}
        </Alert>
      )}

      <Group justify="space-between">
        <Button variant="default" onClick={prev} disabled={active === 0 || isPending}>
          Back
        </Button>
        {active < 2 ? (
          <Button onClick={next} color="indigo">
            Next
          </Button>
        ) : (
          <Button onClick={submit} color="indigo" loading={isPending}>
            Create niche
          </Button>
        )}
      </Group>

      <Title order={6} c="dimmed" fw={400} ta="center" mt="sm">
        Step {active + 1} of 3
      </Title>
    </Stack>
  );
}
