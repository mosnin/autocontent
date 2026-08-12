#!/bin/sh
# Build + serve the hero work in isolation on :3400.
#
# Another agent session is building in /home/user/autocontent/web at the
# same time, and two concurrent `next build`s in one tree produce a .next
# that references chunks neither of them wrote. So the sources are mirrored
# into a private project dir (node_modules and public are symlinks) and the
# build happens there. Nothing is written back.
set -e
SRC=/home/user/autocontent/web
SC=/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad
PROJ=$SC/heroproj

if [ -f "$PROJ/server.pid" ]; then
  kill "$(cat "$PROJ/server.pid")" 2>/dev/null || true
  rm -f "$PROJ/server.pid"
  sleep 1
fi

rm -rf "$PROJ/app" "$PROJ/components" "$PROJ/hooks" "$PROJ/lib" "$PROJ/marketing"
cp -a "$SRC/app" "$SRC/components" "$SRC/hooks" "$SRC/lib" "$SRC/marketing" "$PROJ/"
cp -a "$SRC/middleware.ts" "$SRC/next.config.js" "$SRC/package.json" \
      "$SRC/postcss.config.mjs" "$SRC/tsconfig.json" "$SRC/components.json" \
      "$SRC/next-env.d.ts" "$PROJ/"
ln -sfn "$SRC/node_modules" "$PROJ/node_modules"
ln -sfn "$SRC/public" "$PROJ/public"

cd "$PROJ"
rm -rf .next
npx next build > "$SC/hero-build.log" 2>&1 || { tail -25 "$SC/hero-build.log"; exit 1; }
echo "build ok"

npx next start -p 3400 > "$SC/hero-next.log" 2>&1 &
echo $! > "$PROJ/server.pid"
i=0
while [ $i -lt 60 ]; do
  if curl -sf -o /dev/null http://localhost:3400/; then
    # The failure mode that cost an hour: a stylesheet the HTML references
    # but the build never wrote. Fail loudly instead of screenshotting an
    # unstyled page.
    missing=0
    for css in $(curl -s http://localhost:3400/ | strings |
                 grep -o '/_next/static/css/[a-z0-9]*\.css' | sort -u); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3400$css")
      [ "$code" = "200" ] || { echo "MISSING CSS $css ($code)"; missing=1; }
    done
    [ "$missing" = "0" ] && echo up && exit 0
    exit 1
  fi
  i=$((i + 1)); sleep 1
done
echo "server did not come up"; tail -20 "$SC/hero-next.log"; exit 1
