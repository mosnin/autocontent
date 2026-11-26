# Third-party notices

Code in this repository adapted from other projects, with the licence each was
used under. Files that contain adapted code say so in their header.

## MoneyPrinterTurbo

- Source: https://github.com/harry0703/MoneyPrinterTurbo
- Used in: `src/marketer/short_video/stock.py` (Pexels and Pixabay response
  parsing, rendition choice), `src/marketer/short_video/edit_plan.py` (clip
  plan: slicing by clip length and speed, unique-source ordering, coverage and
  looping), `src/marketer/short_video/render.py` (fit and transition choices as
  ffmpeg filters), and the idea behind script-corrected subtitles in
  `src/marketer/short_video/captions.py`. See `docs/short-video.md`.

```
MIT License

Copyright (c) 2024 Harry

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
