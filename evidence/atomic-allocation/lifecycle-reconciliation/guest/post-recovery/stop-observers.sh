#!/bin/sh
set -eu
for n in "$@"; do
 f=/tmp/pids/r6-confirm-post-watch-$n.pid
 p=$(cat "$f")
 uid=$(ps -o uid= -p "$p" | tr -d ' ')
 pgid=$(ps -o pgid= -p "$p" | tr -d ' ')
 args=$(ps -o args= -p "$p")
 ps -o pid=,ppid=,pgid=,uid=,args= -p "$p" >> /tmp/post-recovery/logs/observer-identities-before-stop.txt
 test "$uid" = 30033
 test "$pgid" = "$p"
 case "$args" in 'timeout 1800 sh /tmp/post-recovery/observe.sh '*|'timeout 1800 sh /tmp/post-recovery/observe-names.sh') ;; *) exit 44;; esac
 /bin/kill -TERM -- "-$p"
 printf 'r6-post stopped observer group %s\n' "$p" | tee -a /tmp/shared-resources /tmp/post-recovery/resources/pids
done
