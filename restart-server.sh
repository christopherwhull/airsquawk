#!/bin/bash
# Restart the Node.js server on Linux/Mac
# This script stops any existing server and starts a fresh instance

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Stopping existing Node.js server..."

# Kill any existing node process running server.js in this directory
pkill -f "node.*server.js" || true

# Wait a moment for process to terminate
sleep 2

echo "Starting Node.js server..."

# Start the server in the background
node server.js &

# Get the PID
SERVER_PID=$!

echo "Node.js server started with PID $SERVER_PID"
echo "Access http://localhost:3002/"
echo ""
echo "Server logs will appear below:"
echo "---"

# Wait for the server process and keep the script running
wait $SERVER_PID
