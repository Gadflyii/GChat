#!/bin/bash
# Ubuntu install script for GChat app

IS_NIGHTLY="$1"

INSTALLER_PATH="/tmp/gchat-installer.deb"

echo "Installing GChat app..."
echo "Is nightly build: $IS_NIGHTLY"

# Install the .deb package
sudo apt install "$INSTALLER_PATH" -y
sudo apt-get install -f -y

# Wait for installation to complete
sleep 10

echo "[INFO] Waiting for GChat app first initialization (120 seconds)..."
echo "This allows GChat to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if [ "$IS_NIGHTLY" = "true" ]; then
    DEFAULT_JAN_PATH="/usr/bin/GChat-nightly"
    PROCESS_NAME="GChat-nightly"
else
    DEFAULT_JAN_PATH="/usr/bin/GChat"
    PROCESS_NAME="GChat"
fi

if [ -f "$DEFAULT_JAN_PATH" ]; then
    echo "GChat app installed successfully at: $DEFAULT_JAN_PATH"
    echo "GCHAT_APP_PATH=$DEFAULT_JAN_PATH" >> $GITHUB_ENV
    echo "GCHAT_PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV
else
    echo "GChat app not found at expected location: $DEFAULT_JAN_PATH"
    echo "Will auto-detect during test run"
fi
