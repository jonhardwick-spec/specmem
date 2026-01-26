#!/bin/bash
echo "Stopping all embedding server processes..."
pids=$(ps aux | grep "frankenstein-embeddings.py" | grep -v grep | awk '{print $2}')
if [ -z "$pids" ]; then
  echo "No embedding servers found"
  exit 0
fi
echo "Found processes: $pids"
for pid in $pids; do
  echo "Sending SIGTERM to $pid"
  kill -TERM $pid 2>/dev/null
done
sleep 5
survivors=$(ps aux | grep "frankenstein-embeddings.py" | grep -v grep | awk '{print $2}')
if [ -n "$survivors" ]; then
  echo "Sending SIGKILL to survivors"
  for pid in $survivors; do
    kill -9 $pid 2>/dev/null
  done
fi
rm -f /specmem/sockets/embeddings.sock
rm -f /specmem/sockets/embedding.pid
rm -f /specmem/sockets/embedding.starting
rm -f /specmem/sockets/bootstrap.lock
echo "Cleanup complete"
