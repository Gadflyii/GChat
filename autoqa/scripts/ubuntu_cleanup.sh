#!/bin/bash
# Ubuntu cleanup script for GChat app

echo "Cleaning existing GChat installations..."

# Remove GChat data folders (both regular and nightly)
rm -rf ~/.config/GChat
rm -rf ~/.config/GChat-nightly
rm -rf ~/.local/share/GChat
rm -rf ~/.local/share/GChat-nightly
rm -rf ~/.cache/gchat
rm -rf ~/.cache/gchat-nightly
rm -rf ~/.local/share/gchat-nightly.ai.app
rm -rf ~/.local/share/gchat.ai.app

# Kill any running GChat processes (both regular and nightly)
pkill -f "GChat" || true
pkill -f "gchat" || true
pkill -f "GChat-nightly" || true
pkill -f "gchat-nightly" || true

echo "GChat cleanup completed"
