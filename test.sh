#!/bin/bash

# Configuration
AT_ROOT="Anchor.toml"
LOG_MB="/dev/null"
LOG_EV="/dev/null"

# Setup Logging Redirection
if [[ "$LOG" == "ON" ]]; then
    if [[ ! -f "$AT_ROOT" ]]; then
        echo "Error: Anchor.toml not found. Execute from project root."
        exit 1
    fi
    echo "✅ Logging enabled. Writing to .log files."
    OUT_MB="mb-validator.log"
    OUT_EV="ephemeral-validator.log"
else
    # We use /dev/null for both output AND errors to ensure total silence
    OUT_MB="/dev/null"
    OUT_EV="/dev/null"
fi

# Cleanup any old ledger data or hanging processes
echo "Cleaning up old ledger and processes..."

# mb-test-validator spawns a solana-test-validator
pkill -f solana-test-validator 2>/dev/null
pkill -f ephemeral-validator 2>/dev/null
rm -rf test-ledger/
sleep 1

# Start the validators in the background 
# & wait for them to start
echo "Starting magicblock test validator..."
nohup mb-test-validator --reset > "$OUT_MB" 2>&1 < /dev/null &

until curl -s http://127.0.0.1:8899 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    | grep -q "ok"; do
    sleep 1
done

echo "Starting ephemeral validator..."
RUST_LOG=info nohup ephemeral-validator \
  --remotes "http://127.0.0.1:8899" \
  --remotes "ws://127.0.0.1:8900"  \
  -l "127.0.0.1:7799" \
  > "$OUT_EV" 2>&1 < /dev/null &

VALIDATOR="mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
until curl -s --request POST \
    --url http://127.0.0.1:7799 \
    --header "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","id":1,"method":"getIdentity"}' \
    | grep -q "$VALIDATOR"; do
    sleep 1
done

echo "All validators are healthy!"

# 4. Run Anchor tests
echo "Running Anchor tests..."
EPHEMERAL_PROVIDER_ENDPOINT=http://127.0.0.1:7799 \
EPHEMERAL_WS_ENDPOINT=ws://127.0.0.1:7800 \
PROVIDER_ENDPOINT=http://127.0.0.1:8899 \
WS_ENDPOINT=ws://127.0.0.1:8900 \
anchor test --skip-local-validator

# 5. Cleanup on exit
# This ensures the validators don't stay running in the background forever
pkill -f solana-test-validator
pkill -f ephemeral-validator