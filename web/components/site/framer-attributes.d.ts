// The export emits a handful of non-standard attributes on plain elements.
// They are inert, but the transcription keeps them so the DOM matches the
// source exactly — dropping them is the first step toward a lookalike.
// Declaring them is narrower than casting elements to `any`.
import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    parentsize?: string;
    _constraints?: string;
    rotation?: string;
    shadows?: string;
    name?: string;
    as?: string;
  }
}
