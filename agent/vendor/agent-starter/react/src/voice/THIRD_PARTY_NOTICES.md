# Third-party notices: `@agent-starter/react/voice`

Some files in this directory adapt code or patterns from LiveKit's official starters. Each adapted
file names its source in a header comment and says what changed.

| File | Source | License |
|---|---|---|
| `use-bar-animator.ts` | `livekit-examples/agent-starter-react` `hooks/agents-ui/use-agent-audio-visualizer-bar.ts` (commit `9e1fc2f`), originating in LiveKit Agents UI (`livekit/components-js` `packages/shadcn`) | Apache-2.0 (Agents UI), redistributed by the starter under MIT. Modified (see header). |
| `VoiceVisualizer.tsx` | markup idea from `agent-starter-react` `components/agents-ui/agent-audio-visualizer-bar.tsx` | Apache-2.0 / MIT, re-implemented |
| `VoiceSession.tsx` | composition pattern from `agent-starter-react` `components/app/app.tsx`, `view-controller.tsx` | MIT, re-implemented |
| `use-voice-errors.ts` | `agent-starter-react` `hooks/useAgentErrors.tsx` | MIT, modified |
| `use-publish-permissions.ts` | `livekit-examples/agent-starter-embed` `hooks/use-publish-permissions.ts` (commit `1cb7223`) | MIT, modified |
| `mount-voice-widget.tsx` | `agent-starter-embed` `components/embed-popup/standalone-bundle-root.tsx` | MIT, modified |
| `styles.ts` (`shadowStyles`) | `agent-starter-embed` `lib/styles.ts` (`getShadowStyles`) | MIT, modified (colors sanitized) |

Not copied on purpose: the starters' token endpoints (client-controlled dispatch, no auth), the embed's
`use-connection-details.ts` (expiry bug) and `next.config.ts` (`frame-ancestors *`), fonts, logos and
other LiveKit branding.

## MIT License (LiveKit starters)

MIT License

Copyright (c) 2025  LiveKit, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Apache License 2.0 (LiveKit Agents UI)

`use-bar-animator.ts` is derived from LiveKit Agents UI, Copyright 2025 LiveKit, Inc., licensed under the
Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND. The file was modified by Agent Starter; the header lists the
changes (section 4(b)).
