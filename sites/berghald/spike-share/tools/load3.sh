#!/bin/bash
U=${SPIKE_URL:?set SPIKE_URL to the workers.dev URL}
N=${1:-25}
T='Hellul%C3%B6gn%20og%20hle%C3%B0sla%20vi%C3%B0%20sumarh%C3%BAs%20%C3%AD%20%C3%9Eingvallasveit'
for i in $(seq 1 $N); do
  for v in \
    "og-r2-260k-store:/og?src=r2&cover=cover-m.jpg&store=1&size=64&title=$T" \
    "cover-r2-260k-store:/cover?src=r2&cover=cover-m.jpg&store=1" \
    "og-r2-60k-store-b:/og?src=r2&cover=cover-s.jpg&store=1&size=64&title=$T"; do
    name=${v%%:*}; path=${v#*:}
    curl -s -o /dev/null -w "$name %{http_code}\n" "$U$path&v=$name&i=$i" | grep -v " 20[04]$"
  done
done
sleep 10
echo done
