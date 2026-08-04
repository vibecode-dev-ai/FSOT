#!/bin/bash
# Double-click this file in Finder to start the FSOT Study App.
#
# A local server is required: browsers block JavaScript modules and local
# file reads when a page is opened directly from disk (file://).

cd "$(dirname "$0")" || exit 1

PORT=8765

# Find a free port if 8765 is taken.
while lsof -i ":$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT"

echo "FSOT Study App"
echo "=============="
echo "Serving from: $(pwd)"
echo "Open:         $URL"
echo
echo "Press Ctrl-C to stop the server."
echo

# Give the server a moment to bind before opening the browser.
( sleep 1 && open "$URL" ) &

python3 -m http.server "$PORT"
