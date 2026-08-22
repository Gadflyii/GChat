#!/bin/bash
# macOS cleanup script for GChat

echo "Cleaning existing GChat installations..."

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
rm -rf ~/Library/Application\ Support/app.gchat
rm -rf ~/Library/Application\ Support/app.gchat-nightly
rm -rf ~/Library/Preferences/app.gchat*
rm -rf ~/Library/Preferences/app.gchat-nightly*
rm -rf ~/Library/Caches/app.gchat*
rm -rf ~/Library/Caches/app.gchat-nightly*
rm -rf ~/Library/Caches/app.gchat
rm -rf ~/Library/Caches/app.gchat-nightly
rm -rf ~/Library/WebKit/app.gchat
rm -rf ~/Library/WebKit/app.gchat-nightly
rm -rf ~/Library/Saved\ Application\ State/app.gchat
rm -rf ~/Library/Saved\ Application\ State/app.gchat-nightly

echo "GChat cleanup completed"
