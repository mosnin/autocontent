# distortion-waves (vendored)

- **What:** the Distortion waves React component from Libraries.dev (https://libraries.dev/waves).
- **Source:** https://github.com/Jakubantalik/Libraries.dev, directory `packages/distortion-waves`, version 0.1.0.
- **Commit:** 371b324a253b8ee71b9ce1bc8a1ecc5a59e1a16a (17 Nov 2026).
- **Licence:** MIT, see `LICENSE` in this folder. Copyright (c) 2026 Jakub Antalik.
- **Why vendored:** the package was not on the public npm registry when it was added (`npm install distortion-waves` returned 404), so the source is copied here unmodified. When it is published, replace this folder with the dependency and delete it.
- **Changes from upstream:** none. Do not edit these files; wrap them (see `web/design-system/components/wave.tsx`).
- **Review notes:** no dependencies beyond React. No telemetry, no dynamic code, no storage access. Its only network use is `fetch` of the page's own stylesheets, fonts and images, to inline them into the picture the wave bends (`src/capture.ts`). It needs `img-src data: blob:` and `font-src data:` in the Content-Security-Policy.
- **Only import it through** `@/design-system` (`CommitWave`). `npm run ds:guard` enforces this.
