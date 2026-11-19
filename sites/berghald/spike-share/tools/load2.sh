#!/bin/bash
# Matrix: each variant tagged with v=<name>, N runs, sequential.
U=${SPIKE_URL:?set SPIKE_URL to the workers.dev URL}
N=${1:-20}
T='Hellul%C3%B6gn%20og%20hle%C3%B0sla%20vi%C3%B0%20sumarh%C3%BAs%20%C3%AD%20%C3%9Eingvallasveit'
for i in $(seq 1 $N); do
  for v in \
    "info-assets-660k:/info?cover=cover.jpg" \
    "info-r2-60k:/info?src=r2&cover=cover-s.jpg" \
    "info-r2-660k:/info?src=r2&cover=cover.jpg" \
    "info-r2-6.5M:/info?src=r2&cover=cover-xl.jpg" \
    "cover-r2-60k-respond:/cover?src=r2&cover=cover-s.jpg" \
    "cover-r2-660k-respond:/cover?src=r2&cover=cover.jpg" \
    "og-r2-60k-store:/og?src=r2&cover=cover-s.jpg&store=1&size=64&title=$T" \
    "og-r2-660k-store:/og?src=r2&cover=cover.jpg&store=1&size=64&title=$T" \
    "og-r2-6.5M-store:/og?src=r2&cover=cover-xl.jpg&store=1&size=64&title=$T" \
    "og-r2-660k-respond:/og?src=r2&cover=cover.jpg&size=64&title=$T"; do
    name=${v%%:*}; path=${v#*:}
    curl -s -o /dev/null -w "$name %{http_code}\n" "$U$path&v=$name&i=$i" | grep -v " 20[04]$"
  done
done
sleep 10
echo done
