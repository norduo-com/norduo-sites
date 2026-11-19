#!/bin/bash
# Fire N requests per variant at the spike Worker, sequentially.
U=${SPIKE_URL:?set SPIKE_URL to the workers.dev URL}
N=${1:-25}
sleep 8 # let tail connect
for i in $(seq 1 $N); do
  curl -s -o /dev/null "$U/noop?i=$i"
  curl -s -o /dev/null "$U/cover?i=$i"
  curl -s -o /dev/null "$U/og?size=64&i=$i&title=Hellul%C3%B6gn%20og%20hle%C3%B0sla%20vi%C3%B0%20sumarh%C3%BAs%20n%C3%BAmer%20$i%20%C3%AD%20%C3%9Eingvallasveit"
  curl -s -o /dev/null "$U/og?size=72&i=$i&maxLines=3&title=Endurger%C3%B0%20gar%C3%B0s%2C%20hellul%C3%B6gn%2C%20snj%C3%B3br%C3%A6%C3%B0sla%2C%20steinhle%C3%B0sla%20og%20gr%C3%B3%C3%B0ursetning%20vi%C3%B0%20einb%C3%BDlish%C3%BAs%20n%C3%BAmer%20$i"
done
sleep 10 # let tail flush
echo done
