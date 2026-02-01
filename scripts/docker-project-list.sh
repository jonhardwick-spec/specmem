#!/bin/bash
# ============================================
# SpecMem Docker Project List
# ============================================
# List all running SpecMem Docker project instances
#
# Usage:
#   ./docker-project-list.sh

echo "=========================================="
echo "SpecMem Docker - Active Project Instances"
echo "=========================================="

# Find all SpecMem containers
CONTAINERS=$(docker ps --filter "name=specmem-postgres-" --filter "name=specmem-server-" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null)

if [[ -z "$CONTAINERS" ]]; then
    echo "No active SpecMem project instances found."
    echo ""
    echo "Start a new instance with: ./scripts/docker-project-up.sh"
else
    echo ""
    printf "%-35s %-20s %s\n" "CONTAINER" "STATUS" "PORTS"
    echo "-------------------------------------------------------------------"
    echo "$CONTAINERS" | while IFS=$'\t' read -r name status ports; do
        printf "%-35s %-20s %s\n" "$name" "$status" "$ports"
    done
fi

echo ""
echo "=========================================="

# Show volumes
echo ""
echo "Project Volumes:"
echo "-------------------------------------------------------------------"
docker volume ls --filter "name=specmem-" --format "{{.Name}}" 2>/dev/null | sort

echo ""
echo "=========================================="
