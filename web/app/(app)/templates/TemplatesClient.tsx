"use client";

// Template library: admin-curated looks with the exact prompt attached.
// Remix = your product photo + the template's prompt -> same aesthetic,
// your product. Results land in Library -> Images.
//
// Chrome recladded to the Square UI marketing-dashboard kit
// (components/square/ui/*): Card/Badge/Button/Input chrome swapped in.
// square/ui has no Label primitive, so Label stays the existing app
// primitive (@/components/ui/label) — same precedent as the niches
// port. No handler/logic changes.

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { Input } from "@/components/square/ui/input";
import { Label } from "@/components/ui/label";
import { DashHeading } from "@/components/hub/dashboard-kit";

export interface Template {
  id: string;
  kind: "video" | "image" | "carousel";
  name: string;
  description: string;
  prompt: string;
  reference_key: string;
  is_published: boolean;
  created_at: string;
}

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function TemplatesClient({ initial }: { initial: Template[] }) {
  return (
    <div className="space-y-6">
      <DashHeading
        as="h1"
        sub="Curated looks with their exact prompt attached. Remix one with your product photo — same aesthetic, your product. Results land in Library → Images."
      >
        Templates
      </DashHeading>

      {initial.length === 0 && (
        <Card className="rounded-lg border bg-card">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No templates published yet. Admins add them from the admin
            console (or via the API) with a reference image + prompt.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {initial.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  const remix = async () => {
    setBusy(true);
    try {
      const product_image_b64 = file ? await fileToB64(file) : "";
      const res = await fetch(`/api/proxy/api/v1/templates/${template.id}/remix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_image_b64, count: 2 }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success("Remix started — check Library → Images in a minute");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-lg border bg-card py-0 gap-0">
      {template.reference_key && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/proxy/api/v1/templates/${template.id}/reference`}
          alt={template.name}
          className="aspect-square w-full object-cover"
        />
      )}
      <CardHeader className="pt-6">
        <CardTitle className="flex items-center gap-2 text-base">
          {template.name}
          <Badge variant="secondary" className="capitalize">{template.kind}</Badge>
        </CardTitle>
        {template.description && (
          <CardDescription>{template.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pb-6">
        {template.kind !== "video" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`remix-file-${template.id}`}>
                Your product photo (optional)
              </Label>
              <Input
                id={`remix-file-${template.id}`}
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button onClick={remix} disabled={busy} className="w-full">
              {busy ? "Starting…" : "Remix"}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Video template — copy its prompt into a niche&apos;s visual style
            to use this look.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
