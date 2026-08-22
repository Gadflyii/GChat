#!/bin/bash
# macOS post-test cleanup script

echo "Cleaning up after tests..."

# Kill any running GChat processes (both regular and nightly)
pkill -f "GChat" || true
pkill -f "gchat" || true
pkill -f "GChat-nightly" || true
pkill -f "gchat-nightly" || true

# Remove GChat app directories
rm -rf /Applications/GChat.app
rm -rf /Applications/GChat-nightly.app
rm -rf ~/Applications/GChat.app
rm -rf ~/Applications/GChat-nightly.app

# Remove GChat data folders (both regular and nightly)
rm -rf ~/Library/Application\ Support/GChat
rm -rf ~/Library/Application\ Support/GChat-nightly
rm -rf ~/Library/Application\ Support/gchat.ai.app
rm -rf ~/Library/Application\ Support/gchat-nightly.ai.app
rm -rf ~/Library/Preferences/gchat.*
rm -rf ~/Library/Preferences/gchat-nightly.*
rm -rf ~/Library/Caches/gchat.*
rm -rf ~/Library/Caches/gchat-nightly.*
rm -rf ~/Library/Caches/gchat.ai.app
rm -rf ~/Library/Caches/gchat-nightly.ai.app
rm -rf ~/Library/WebKit/gchat.ai.app
rm -rf ~/Library/WebKit/gchat-nightly.ai.app
rm -rf ~/Library/Saved\ Application\ State/gchat.ai.app
rm -rf ~/Library/Saved\ Application\ State/gchat-nightly.ai.app

# Clean up downloaded installer
rm -f "/tmp/gchat-installer.dmg"
rm -rf "/tmp/gchat-mount"

echo "Cleanup completed"
