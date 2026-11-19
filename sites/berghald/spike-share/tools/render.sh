#!/bin/bash
# usage: render.sh <outfile> <size> <title> [extra query]
S=${OUT_DIR:-.}
U=${SPIKE_URL:?set SPIKE_URL to the workers.dev URL}
T=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$3")
curl -s -o "$S/$1" -D "$S/$1.h" -w "$1 %{http_code} %{size_download}B %{time_total}s\n" "$U/og?size=$2&title=$T&$4"
grep -i x-spike "$S/$1.h" | python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read()).strip())"
