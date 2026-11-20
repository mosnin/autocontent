// Access control for the fixture preview (/preview/**). The pages render the
// app shell with made-up data and no sign-in, for design review and the
// screenshot tooling. They are served in development; in production they are
// a 404 unless ENABLE_PREVIEW=1. The middleware applies the same rule first;
// this layout is the check that holds even if the matcher changes.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { previewEnabled } from "@/lib/security/urls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (!previewEnabled(process.env)) notFound();
  return children;
}
