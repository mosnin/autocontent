"use client";

// Content Studio: on-demand AI image/video tools backed by fal.ai. Left
// panel picks a tool and its inputs; right panel accumulates this
// session's results as a grid, each usable as the next tool's source.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Clapperboard,
  ExternalLink,
  ImagePlus,
  Loader2,
  Scissors,
  Trash2,
  Wand2,
  X,
  ZoomIn,
} from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GradientText } from "@/components/ui/gradient-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/client-fetcher";
import type { Niche } from "@/lib/types";
import {
  IMAGE_EDIT_MODELS,
  IMAGE_MODELS,
  UPSCALE_MODELS,
  VIDEO_MODELS,
  animateImage,
  deleteMedia,
  editImage,
  fetchMediaPage,
  generateImage,
  humanizeStudioError,
  mediaFileUrl,
  probeStudioStatus,
  removeBackground,
  upscaleImage,
  type MediaAsset,
  type ModelOption,
} from "@/lib/studio-client";

type ToolKind = "generate" | "edit" | "upscale" | "remove_bg" | "animate";

const TOOLS: { value: ToolKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "generate", label: "Generate", icon: ImagePlus },
  { value: "edit", label: "Edit", icon: Wand2 },
  { value: "upscale", label: "Upscale", icon: ZoomIn },
  { value: "remove_bg", label: "Remove background", icon: Scissors },
  { value: "animate", label: "Animate", icon: Clapperboard },
];

const MODEL_OPTIONS_BY_TOOL: Partial<Record<ToolKind, ModelOption[]>> = {
  generate: IMAGE_MODELS,
  edit: IMAGE_EDIT_MODELS,
  upscale: UPSCALE_MODELS,
  animate: VIDEO_MODELS,
};

const RESULT_LABEL: Record<ToolKind, string> = {
  generate: "Image generated.",
  edit: "Edit done.",
  upscale: "Upscale done.",
  remove_bg: "Background removed.",
  animate: "Video rendered.",
};

interface SourceRef {
  mediaId?: string;
  imageUrl?: string;
  previewUrl: string;
  label: string;
}

function assetToSourceRef(asset: MediaAsset): SourceRef {
  return {
    mediaId: asset.id,
    previewUrl: mediaFileUrl(asset.id),
    label: (asset.meta.prompt as string | undefined) || asset.id,
  };
}

export function StudioClient({
  initialSource,
  niches,
}: {
  initialSource: MediaAsset | null;
  niches: Niche[];
}) {
  const router = useRouter();
  const confirm = useConfirm();

  const { data: status, mutate: mutateStatus } = useSWR(
    "studio-status-probe",
    probeStudioStatus,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const [tool, setTool] = React.useState<ToolKind>(initialSource ? "edit" : "generate");
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState<string>("");
  const [nicheId, setNicheId] = React.useState<string>("none");
  const [source, setSource] = React.useState<SourceRef | null>(
    initialSource ? assetToSourceRef(initialSource) : null,
  );
  const [pending, setPending] = React.useState(false);
  const [results, setResults] = React.useState<MediaAsset[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pasteUrl, setPasteUrl] = React.useState("");

  function switchTool(next: ToolKind) {
    setTool(next);
    setModel("");
  }

  function handleToolError(e: unknown) {
    if (e instanceof ApiError && e.status === 503) {
      // Flip the whole page into the disabled state so a stale token or a
      // key rotated mid-session doesn't leave a broken form behind.
      void mutateStatus({ enabled: false }, { revalidate: false });
      return;
    }
    const message = humanizeStudioError(e);
    if (e instanceof ApiError && e.status === 402) {
      toast.error(message, {
        action: {
          label: "Add credit",
          onClick: () => router.push("/settings/billing"),
        },
      });
      return;
    }
    toast.error(message);
  }

  function sourceInput(): { media_id?: string; image_url?: string } {
    if (!source) return {};
    return source.mediaId ? { media_id: source.mediaId } : { image_url: source.imageUrl };
  }

  async function runTool() {
    setPending(true);
    try {
      const nid = nicheId === "none" ? undefined : nicheId;
      let asset: MediaAsset;
      if (tool === "generate") {
        asset = await generateImage({ prompt: prompt.trim(), model: model || undefined, niche_id: nid });
      } else if (tool === "edit") {
        asset = await editImage({
          prompt: prompt.trim(),
          model: model || undefined,
          niche_id: nid,
          ...sourceInput(),
        });
      } else if (tool === "upscale") {
        asset = await upscaleImage({ model: model || undefined, niche_id: nid, ...sourceInput() });
      } else if (tool === "remove_bg") {
        asset = await removeBackground({ niche_id: nid, ...sourceInput() });
      } else {
        asset = await animateImage({
          prompt: prompt.trim() || undefined,
          model: model || undefined,
          niche_id: nid,
          ...sourceInput(),
        });
      }
      setResults((prev) => [asset, ...prev]);
      toast.success(RESULT_LABEL[tool]);
    } catch (e) {
      handleToolError(e);
    } finally {
      setPending(false);
    }
  }

  async function onDeleteResult(asset: MediaAsset) {
    const ok = await confirm({
      title: "Delete this result?",
      description: "It's removed from the library. This can't be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMedia(asset.id);
      setResults((prev) => prev.filter((r) => r.id !== asset.id));
      if (source?.mediaId === asset.id) setSource(null);
      toast.success("Deleted");
    } catch (e) {
      toast.error(humanizeStudioError(e));
    }
  }

  function useAsSource(asset: MediaAsset) {
    setSource(assetToSourceRef(asset));
    if (tool === "generate") setTool("edit");
    toast.success("Set as source");
  }

  const needsPrompt = tool === "generate" || tool === "edit";
  const needsSource = tool !== "generate";
  const promptRequired = tool === "generate" || tool === "edit";
  const modelOptions = MODEL_OPTIONS_BY_TOOL[tool];
  const canSubmit =
    !pending &&
    (!promptRequired || prompt.trim().length > 0) &&
    (!needsSource || !!source);

  if (status === undefined) {
    return <ToolsSkeleton />;
  }

  if (!status.enabled) {
    return <DisabledCard />;
  }

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            Content <GradientText>Studio</GradientText>
          </h1>
          <p className="max-w-xl text-[15px] text-muted-foreground">
            Generate, edit, upscale, and animate images on demand. Every
            result lands in the media library too.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tools</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Tabs value={tool} onValueChange={(v) => switchTool(v as ToolKind)}>
                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/60 p-1 sm:grid-cols-5">
                  {TOOLS.map(({ value, label, icon: Icon }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="flex-col gap-1 py-2 text-[11px]"
                      title={label}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {needsSource && (
                <div className="space-y-2">
                  <Label>Source image</Label>
                  {source ? (
                    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={source.previewUrl}
                        alt=""
                        className="h-14 w-14 rounded-md object-cover"
                      />
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {source.label}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setSource(null)}
                        aria-label="Clear source"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPickerOpen(true)}
                        type="button"
                      >
                        Choose from library
                      </Button>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Or paste an image URL"
                          value={pasteUrl}
                          onChange={(e) => setPasteUrl(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!pasteUrl.trim()}
                          onClick={() => {
                            setSource({
                              imageUrl: pasteUrl.trim(),
                              previewUrl: pasteUrl.trim(),
                              label: pasteUrl.trim(),
                            });
                            setPasteUrl("");
                          }}
                        >
                          Use
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {needsPrompt && (
                <div className="space-y-2">
                  <Label htmlFor="studio-prompt">Prompt</Label>
                  <Textarea
                    id="studio-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    placeholder={
                      tool === "generate"
                        ? "A neon-lit night market, cinematic, wide shot"
                        : "Make the background darker, add rain"
                    }
                  />
                </div>
              )}

              {tool === "animate" && (
                <div className="space-y-2">
                  <Label htmlFor="studio-prompt-animate">Prompt (optional)</Label>
                  <Textarea
                    id="studio-prompt-animate"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Slow push in, gentle camera drift"
                  />
                </div>
              )}

              {modelOptions && (
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Select
                    value={model || modelOptions[0].id}
                    onValueChange={(v) => setModel(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Channel (optional)</Label>
                <Select value={nicheId} onValueChange={setNicheId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No channel</SelectItem>
                    {niches.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tool === "animate" && (
                <p className="text-xs text-muted-foreground">
                  Rendering can take a minute or two. This tab stays open
                  until it finishes.
                </p>
              )}

              <Button onClick={runTool} disabled={!canSubmit} className="w-full">
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {tool === "animate" ? "Rendering…" : "Working…"}
                  </>
                ) : (
                  TOOLS.find((t) => t.value === tool)?.label
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Results this session</CardTitle>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    Results from this session will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {results.map((asset) => (
                    <ResultTile
                      key={asset.id}
                      asset={asset}
                      onUseAsSource={() => useAsSource(asset)}
                      onDelete={() => onDeleteResult(asset)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Reveal>

      <SourcePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(asset) => {
          setSource(assetToSourceRef(asset));
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function ResultTile({
  asset,
  onUseAsSource,
  onDelete,
}: {
  asset: MediaAsset;
  onUseAsSource: () => void;
  onDelete: () => void;
}) {
  const src = mediaFileUrl(asset.id);
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <div className="aspect-square w-full bg-muted/40">
        {asset.kind === "video" ? (
          <video src={src} muted loop playsInline className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <Badge variant="secondary" className="absolute left-2 top-2 capitalize">
        {asset.kind}
      </Badge>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button asChild variant="ghost" size="icon-sm" className="text-white hover:bg-white/20 hover:text-white">
          <Link href={`/library?open=${asset.id}`} aria-label="Open in library">
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
        {asset.kind === "image" && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={onUseAsSource}
            aria-label="Use as source"
          >
            <Wand2 className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={onDelete}
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SourcePickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (asset: MediaAsset) => void;
}) {
  const { data, isLoading } = useSWR(
    open ? "studio-source-picker" : null,
    () => fetchMediaPage({ kind: "image", limit: 24 }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a source image</DialogTitle>
          <DialogDescription>
            From your media library, images only.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No images in the library yet.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto sm:grid-cols-6">
            {data.items.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onPick(asset)}
                className="aspect-square overflow-hidden rounded-md border border-border/60 transition-opacity hover:opacity-80"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaFileUrl(asset.id)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisabledCard() {
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">
          Content <GradientText>Studio</GradientText>
        </h1>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="rounded-full bg-muted p-3">
            <Wand2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold">Studio isn&apos;t configured yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Content Studio needs a fal.ai API key on the backend before any
            of these tools will run. Set MARKETER_FAL_API_KEY and reload
            this page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ToolsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
