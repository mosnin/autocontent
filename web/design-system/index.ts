// Marketer design system. Import everything from "@/design-system".
// Spec: ./README.md. Tokens: ./tokens.css. References: ./references/.
export { cx } from "./cx";
export * from "./components/primitives";
export * from "./components/layout";
export * from "./components/data";
export * from "./components/agent";
export * from "./components/surfaces";
export { Shader, PALETTES, paletteFor, fieldGradient, cssFallback, type Palette } from "./components/shader";
export * from "./components/kit";
export { Markdown } from "./components/markdown";
export { CommitWave, type WaveMoment } from "./components/wave";
export { AgentSplit, type SplitAgent } from "./components/goo";
export * from "./components/skeletons";
export { PermissionsProvider, useAllowed, NotAllowed, QrCode } from "./components/access";
export { Sheet, Popover, Tag, TagDot, TAG_TONES, type TagTone } from "./components/sheet";
