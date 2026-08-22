#!/bin/bash
# Ubuntu post-test cleanup script

IS_NIGHTLY="$1"

echo "Cleaning up after tests..."

# Kill any running GChat processes (both regular and nightly)
pkill -f "GChat" || true
pkill -f "gchat" || true
pkill -f "GChat-nightly" || true
pkill -f "gchat-nightly" || true

# Remove GChat data folders (both regular and nightly)
rm -rf ~/.config/GChat
rm -rf ~/.config/GChat-nightly
rm -rf ~/.local/share/GChat
rm -rf ~/.local/share/GChat-nightly
rm -rf ~/.cache/gchat
rm -rf ~/.cache/gchat-nightly
rm -rf ~/.local/share/gchat-nightly.ai.app
rm -rf ~/.local/share/gchat.ai.app

# Try to uninstall GChat app
if [ "$IS_NIGHTLY" = "true" ]; then
    PACKAGE_NAME="gchat-nightly"
else
    PACKAGE_NAME="gchat"
fi

echo "Attempting to uninstall package: $PACKAGE_NAME"

if dpkg -l | grep -q "$PACKAGE_NAME"; then
    echo "Found package $PACKAGE_NAME, uninstalling..."
    sudo dpkg -r "$PACKAGE_NAME" || true
    sudo apt-get autoremove -y || true
else
    echo "Package $PACKAGE_NAME not found in dpkg list"
fi

# Clean up downloaded installer
rm -f "/tmp/gchat-installer.deb"

echo "Cleanup completed"
