// Preview views for the business pages. key = path after /preview/app/.
import type { ReactNode } from "react";

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {};
