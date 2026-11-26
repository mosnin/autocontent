# Third-party notices

Code in this repository that was adapted from other projects, with the license it came under. Each adapted file
also carries a header naming its source.

## Open SEO

- Source: https://github.com/maximemarsal/open-seo
- Used in: `src/marketer/services/wordpress.py` (the Yoast post-meta keys, their RankMath equivalents, and the check
  that WordPress did not silently keep a "publish" as a draft). Everything else in Marketer's SEO article features was
  written for Marketer; Open SEO's feature set was the reference (see `docs/seo-articles.md`).

```
MIT License

Copyright (c) 2025 Maxime Marsal

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
