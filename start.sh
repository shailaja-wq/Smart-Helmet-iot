#!/usr/bin/env bash
# ==============================================================================
# SafeRider IoT - 1-Click Startup Script
# Starts the backend server and launches the IoT Command Center Dashboard
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"

echo "==========================================================="
echo "🏍️  Starting SafeRider IoT - Smart Helmet System"
echo "==========================================================="

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js (v18+) to run the server."
    exit 1
fi

cd "${BACKEND_DIR}"

# Check if node_modules exists, install if missing
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
fi

echo "🚀 Launching SafeRider IoT Backend & Dashboard on http://localhost:5000"
echo "👉 Press Ctrl+C to stop the server"
echo "==========================================================="

node server.js
