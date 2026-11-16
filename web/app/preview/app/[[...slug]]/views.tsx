// Registry of preview views: key = the path after /preview/app/.
// Each group file renders pages' pure view components with fixture data.
import type { ReactNode } from "react";
import { VIEWS as business } from "./views-business";
import { VIEWS as insights } from "./views-insights";
import { VIEWS as work } from "./views-work";

export const PREVIEW_VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = { ...insights, ...work, ...business };
