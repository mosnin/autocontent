# Third-party notices

Code or text adapted from other projects, with its license. Projects we only
learned from (no copied code or text) are credited where the idea is used.

## ViMax

- Source: https://github.com/HKUDS/ViMax (revision fd4b72e7731be6e5f88486206d25ea59849b0285)
- License: MIT
- Used in: `src/marketer/story/prompts.py` (prompts adapted from `agents/screenwriter.py`,
  `agents/character_extractor.py`, `agents/storyboard_artist.py` and
  `agents/character_portraits_generator.py`). The story video stage structure in
  `src/marketer/story/pipeline.py` follows ViMax's Idea2Video and Script2Video pipelines; that code is a rewrite,
  not a copy. See `docs/story-video.md`.

```
MIT License

Copyright (c) 2025

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
```
