import { PageSkeleton } from "@/design-system";

/** Fallback for any route without its own loading.tsx. */
export default function Loading() {
  return <PageSkeleton title="Loading" />;
}
