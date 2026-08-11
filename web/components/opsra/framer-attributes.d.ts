// Framer emits a handful of its own attributes on plain elements. They are
// inert without the Framer runtime, but the transcription keeps them so the
// DOM matches the export exactly — dropping them would be the first step
// toward a lookalike rather than a port.
//
// Declaring them here is narrower than casting each element to `any`: it
// keeps every other prop on those elements type-checked.
import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    /** Serialized parent dimensions used by Framer's layout engine. */
    parentsize?: string;
    /** Serialized pin/size constraints from the design file. */
    _constraints?: string;
    /** Layer rotation in degrees. */
    rotation?: string;
    /** Serialized shadow stack. */
    shadows?: string;
    /** Design-file layer name (distinct from `data-framer-name`). */
    name?: string;
    /** Framer's polymorphic tag hint, emitted on <a> where React has no `as`. */
    as?: string;
  }
}
