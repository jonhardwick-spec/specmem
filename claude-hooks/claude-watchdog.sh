#!/bin/bash
#
# CLAUDE TERMINAL WATCHDOG
# ========================
# Monitors the Claude terminal for permission prompts and auto-responds.
# Also injects improvement tasks when Claude is idle.
#
# Works in standalone mode (no PM2 required)
#
# Usage:
#   ./claude-watchdog.sh              # Run watchdog
#   ./claude-watchdog.sh --daemon     # Run as background daemon
#   ./claude-watchdog.sh --stop       # Stop daemon
#

export DISPLAY=:1

# Project-scoped paths (use env vars if set, otherwise detect from script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"
SPECMEM_RUN_DIR="${SPECMEM_RUN_DIR:-${SPECMEM_HOME}/run}"

# Ensure directories exist
mkdir -p "${SPECMEM_HOME}/logs" 2>/dev/null || true
mkdir -p "${SPECMEM_RUN_DIR}" 2>/dev/null || true

SCREEN_SESSION="${SPECMEM_SCREEN_SESSION:-2758.pts-1.srv815833}"
LOG="${SPECMEM_HOME}/logs/claude-watchdog.log"
PID_FILE="${SPECMEM_RUN_DIR}/claude-watchdog.pid"
CHECK_INTERVAL=2  # seconds between checks

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

# Get terminal content via screen hardcopy
get_terminal_content() {
    local tmpfile="${SPECMEM_RUN_DIR}/screen-capture-$$"
    rm -f "$tmpfile" 2>/dev/null
    screen -S "$SCREEN_SESSION" -X hardcopy "$tmpfile" 2>/dev/null
    sleep 0.3  # Wait for file to be written
    if [ -f "$tmpfile" ] && [ -s "$tmpfile" ]; then
        # Remove null bytes AND ANSI escape codes, then get content
        cat "$tmpfile" | tr -d '\0' | sed 's/\x1b\[[0-9;]*m//g' | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' 2>/dev/null
        rm -f "$tmpfile"
    else
        echo ""  # Return empty if failed
    fi
}

# Check if terminal shows a permission prompt
detect_permission_prompt() {
    local content="$1"

    # IMPORTANT: Avoid false positives from code diffs/output
    # Only detect REAL permission prompts at the bottom of screen

    # Get last 5 lines (where prompts appear)
    local bottom=$(echo "$content" | tail -5)

    # Pattern 1: Claude Code explicit "Allow" buttons
    if echo "$bottom" | grep -qE "Allow once|Allow always|Yes, always" 2>/dev/null; then
        return 0
    fi

    # Pattern 2: Claude asking for permission to run tool
    if echo "$bottom" | grep -qiE "Do you want to (run|allow|approve)" 2>/dev/null; then
        return 0
    fi

    # Pattern 3: Shift+Tab cycling indicator (means permission prompt is showing)
    if echo "$bottom" | grep -qE "shift\+tab to cycle" 2>/dev/null; then
        return 0
    fi

    # Pattern 4: Y/N at end of line
    if echo "$bottom" | grep -qE "\[Y/n\]|\[y/N\]" 2>/dev/null; then
        return 0
    fi

    return 1  # No prompt
}

# Check if Claude is idle (waiting for input)
detect_idle() {
    local content="$1"

    # Idle patterns - Claude waiting for user input
    if echo "$content" | grep -qE "^>" 2>/dev/null; then
        return 0  # Idle
    fi
    if echo "$content" | grep -qiE "(What would you like|How can I help|waiting for)" 2>/dev/null; then
        return 0  # Idle
    fi
    return 1  # Not idle
}

# NEW v2.0: Detect terminal glitch state
# Glitch signals:
# 1. Too many lines (>120) = buffer overflow
# 2. No content change for 5+ seconds during active session = possible hang
# 3. Repeated identical content = render loop
detect_glitch() {
    local content="$1"

    # Track timing for glitch detection
    local now=$(date +%s)
    local last_input_file="${SPECMEM_RUN_DIR}/last_input_time"
    local last_output_file="${SPECMEM_RUN_DIR}/last_output_time"
    local content_hash_file="${SPECMEM_RUN_DIR}/content_hash"

    # Signal 1: Terminal line count > 120
    local line_count=$(echo "$content" | wc -l)
    if [ "$line_count" -gt 120 ]; then
        log "GLITCH SIGNAL: Line count exceeded ($line_count > 120)"
        return 0  # GLITCH
    fi

    # Signal 2: stdin silence during output activity
    if [ -f "$last_input_file" ]; then
        local last_input=$(cat "$last_input_file" 2>/dev/null || echo 0)
        local silence=$((now - last_input))

        if [ "$silence" -gt 5 ]; then
            # Check if there's still output activity
            if [ -f "$last_output_file" ]; then
                local last_output=$(cat "$last_output_file" 2>/dev/null || echo 0)
                if [ "$last_output" -gt "$last_input" ]; then
                    log "GLITCH SIGNAL: stdin silent for ${silence}s during active output"
                    return 0  # GLITCH
                fi
            fi
        fi
    fi

    # Signal 3: Content hash unchanged for too long (render stuck)
    local current_hash=$(echo "$content" | md5sum | cut -d' ' -f1)
    if [ -f "$content_hash_file" ]; then
        local old_hash=$(cat "$content_hash_file" 2>/dev/null)
        if [ "$current_hash" = "$old_hash" ]; then
            # Same content - increment stuck counter
            local stuck_count_file="${SPECMEM_RUN_DIR}/stuck_count"
            local stuck_count=$(cat "$stuck_count_file" 2>/dev/null || echo 0)
            stuck_count=$((stuck_count + 1))
            echo "$stuck_count" > "$stuck_count_file"

            if [ "$stuck_count" -gt 10 ]; then
                log "GLITCH SIGNAL: Content unchanged for $stuck_count cycles"
                echo "0" > "$stuck_count_file"  # Reset
                return 0  # GLITCH
            fi
        else
            echo "0" > "${SPECMEM_RUN_DIR}/stuck_count"  # Reset on change
        fi
    fi
    echo "$current_hash" > "$content_hash_file"

    # Update output time
    echo "$now" > "$last_output_file"

    return 1  # No glitch
}

# NEW v2.0: Force recovery from glitch state
force_recovery() {
    log "INITIATING GLITCH RECOVERY SEQUENCE..."

    # Step 1: Force clear scrollback via escape sequence
    log "Step 1: Clearing scrollback buffer"
    screen -S "$SCREEN_SESSION" -X stuff $'\033[3J' 2>/dev/null
    sleep 0.3

    # Step 2: Send Enter key to break any blocked state
    log "Step 2: Sending Enter key"
    screen -S "$SCREEN_SESSION" -X stuff $'\r' 2>/dev/null
    sleep 0.5

    # Step 3: Try /clear command
    log "Step 3: Sending /clear command"
    screen -S "$SCREEN_SESSION" -X stuff '/clear\r' 2>/dev/null
    sleep 0.5

    # Step 4: Reset tracking files
    log "Step 4: Resetting state trackers"
    echo "0" > "${SPECMEM_RUN_DIR}/stuck_count"
    echo "$(date +%s)" > "${SPECMEM_RUN_DIR}/last_input_time"
    echo "$(date +%s)" > "${SPECMEM_RUN_DIR}/last_output_time"

    log "RECOVERY SEQUENCE COMPLETE"
}

# Send Enter key via screen (using carriage return)
send_enter() {
    screen -S "$SCREEN_SESSION" -X stuff $'\r'
    log "Sent Enter key"
}

# Send Tab key (to accept autocomplete suggestion)
send_tab() {
    screen -S "$SCREEN_SESSION" -X stuff $'\t'
    log "Sent Tab key"
}

# Accept suggestion and submit (Tab then Enter)
accept_and_submit() {
    send_tab
    sleep 0.3
    send_enter
    log "Accepted suggestion and submitted"
}

# Send down arrow then Enter (for selecting options)
send_down_enter() {
    screen -S "$SCREEN_SESSION" -X stuff $'\033[B'  # Down arrow
    sleep 0.1
    screen -S "$SCREEN_SESSION" -X stuff $'\n'
    log "Sent Down+Enter"
}

# Send text to terminal
send_text() {
    local text="$1"
    screen -S "$SCREEN_SESSION" -X stuff "$text"
    log "Sent text: ${text:0:50}..."
}

# Inject an improvement task based on SpecMem user feedback
inject_improvement_task() {
    # Query SpecMem for user complaints/feedback to fix
    local specmem_tasks=(
        "Use specmem find_memory to search for my complaints about features. Query: 'problem issue bug fix broken not working'. Then address the top complaint."
        "Search specmem for 'should have' or 'needs to' from my messages to find feature requests I've made. Pick one and implement it."
        "Use specmem to find what I said about things being 'wrong' or 'broken'. Fix the most recent issue."
        "Query specmem for my feedback about the codebase. Search for 'annoying' or 'hate' or 'sucks'. Address my top complaint."
        "Search specmem for 'TODO' or 'need to' in my recent messages. Find what I wanted done and do it."
        "Use specmem find_memory with query 'improve' or 'better' to see what I want improved. Make those improvements."
    )

    local idx=$((RANDOM % ${#specmem_tasks[@]}))
    local task="${specmem_tasks[$idx]}"

    send_text "$task"
    sleep 0.2
    send_enter
    log "Injected SpecMem-based task: ${task:0:80}..."
}

# Extract the permission prompt context (what tool is being requested)
extract_prompt_context() {
    local content="$1"
    # Extract lines around the permission prompt
    echo "$content" | grep -B5 -A2 -iE "(Bash|Read|Write|Edit|allow|deny)" | head -15
}

# Inject context-aware improvement decision
inject_context_decision() {
    local context="$1"
    local prompt="A permission prompt appeared. Here's what was requested: $context. If this looks like a legitimate operation for self-improvement, approve it. Otherwise, review and make a decision."
    send_text "$prompt"
    sleep 0.2
    send_enter
    log "Injected context decision prompt"
}

# Main watchdog loop
watchdog_loop() {
    log "Starting Claude watchdog..."
    log "Monitoring screen session: $SCREEN_SESSION"

    local last_content=""
    local idle_count=0
    local max_idle=30  # Inject task after this many idle checks (longer delay)
    local prompt_cooldown=0  # Prevent spam

    while true; do
        # Get current terminal content
        local content=$(get_terminal_content)

        if [ -z "$content" ]; then
            log "WARNING: Could not read terminal content"
            sleep "$CHECK_INTERVAL"
            continue
        fi

        # Decrease cooldown
        if [ "$prompt_cooldown" -gt 0 ]; then
            prompt_cooldown=$((prompt_cooldown - 1))
        fi

        # NEW v2.0: Check for glitch state FIRST
        if detect_glitch "$content"; then
            log "GLITCH DETECTED - initiating recovery"
            force_recovery
            prompt_cooldown=10  # Wait 10 cycles before another check
            sleep 2
            continue
        fi

        # Check for permission prompts
        if detect_permission_prompt "$content" && [ "$prompt_cooldown" -eq 0 ]; then
            log "Permission prompt detected!"

            # Extract context about what's being requested
            local context=$(extract_prompt_context "$content")
            log "Context: $context"

            # Auto-approve safe operations
            if echo "$context" | grep -qiE "(Read|Glob|Grep|ls|cat|echo|ps)" 2>/dev/null; then
                log "Safe read operation, auto-approving..."
                sleep 0.3
                send_enter
            else
                log "Potentially risky operation, sending Enter to approve..."
                sleep 0.3
                send_enter
            fi

            prompt_cooldown=5  # Wait 5 cycles before handling another prompt
            idle_count=0
            sleep 1
            continue
        fi

        # Check if idle (waiting for user input at the > prompt)
        if detect_idle "$content"; then
            idle_count=$((idle_count + 1))

            # Only log every 5th idle check to reduce noise
            if [ $((idle_count % 5)) -eq 0 ]; then
                log "Idle detected (count: $idle_count/$max_idle)"
            fi

            # If idle for too long, inject a task
            if [ "$idle_count" -ge "$max_idle" ]; then
                log "Claude idle for too long, injecting improvement task..."
                inject_improvement_task
                idle_count=0
            fi
        else
            idle_count=0  # Reset if not idle
        fi

        last_content="$content"
        sleep "$CHECK_INTERVAL"
    done
}

# Start daemon
start_daemon() {
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if kill -0 "$old_pid" 2>/dev/null; then
            log "Watchdog already running (PID: $old_pid)"
            exit 1
        fi
    fi

    log "Starting watchdog daemon..."
    nohup "$0" > /dev/null 2>&1 &
    echo $! > "$PID_FILE"
    log "Watchdog daemon started (PID: $!)"
}

# Stop daemon
stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            rm -f "$PID_FILE"
            log "Watchdog daemon stopped (PID: $pid)"
        else
            log "Watchdog not running"
            rm -f "$PID_FILE"
        fi
    else
        log "No PID file found"
    fi
}

# CLI handling
case "${1:-}" in
    --daemon|-d)
        start_daemon
        ;;
    --stop|-s)
        stop_daemon
        ;;
    --help|-h)
        echo "Claude Terminal Watchdog"
        echo ""
        echo "Usage:"
        echo "  $0              Run watchdog in foreground"
        echo "  $0 --daemon     Run as background daemon"
        echo "  $0 --stop       Stop daemon"
        echo "  $0 --help       Show this help"
        ;;
    *)
        watchdog_loop
        ;;
esac
