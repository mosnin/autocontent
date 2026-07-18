"use client";

import * as React from "react";
import { FileText } from "lucide-react";

import { RepurposeCard } from "@/components/repurpose-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Article } from "@/lib/types";

export function RepurposeClient({ articles }: { articles: Article[] }) {
  const [selected, setSelected] = React.useState<string>(articles[0]?.id ?? "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Repurpose</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Turn a finished article into platform-native social posts: one
          metered generation, charged to the article&apos;s channel cap.
        </p>
      </div>

      {articles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <FileText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No finished articles yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Repurposing needs a finished article to work from. Come back
              once one is done.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="max-w-md space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Article
            </label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an article" />
              </SelectTrigger>
              <SelectContent>
                {articles.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title || a.topic}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && <RepurposeCard key={selected} articleId={selected} />}
        </div>
      )}
    </div>
  );
}
