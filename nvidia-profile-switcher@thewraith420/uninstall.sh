#!/bin/bash

# Nvidia Profile Switcher Desklet Uninstallation Script
# Copyright (C) 2024 thewraith420

set -e  # Exit on error

DESKLET_UUID="nvidia-profile-switcher@thewraith420"
DESKLET_DIR="$HOME/.local/share/cinnamon/desklets/$DESKLET_UUID"
SETTINGS_FILE="$HOME/.config/nvidia-profile-switcher-settings.json"
ICON_DIR="/usr/share/icons/hicolor/scalable/apps"

echo "======================================="
echo "Nvidia Profile Switcher Uninstaller"
echo "======================================="
echo ""

# Remove desklet files
if [ -d "$DESKLET_DIR" ]; then
    echo "Removing desklet files..."
    rm -rf "$DESKLET_DIR"
    echo "✓ Desklet files removed"
else
    echo "Desklet directory not found (already removed?)"
fi

# Remove settings file
if [ -f "$SETTINGS_FILE" ]; then
    read -p "Remove saved settings? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -f "$SETTINGS_FILE"
        echo "✓ Settings file removed"
    fi
fi

# Remove icons (requires sudo)
echo ""
read -p "Remove custom icons? This requires sudo. (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo rm -f "$ICON_DIR/intel-mode.svg" 2>/dev/null || true
    sudo rm -f "$ICON_DIR/hybrid-mode.svg" 2>/dev/null || true
    
    # Update icon cache
    if command -v gtk-update-icon-cache &> /dev/null; then
        sudo gtk-update-icon-cache "$ICON_DIR/.." 2>/dev/null || true
    fi
    echo "✓ Icons removed and cache updated"
fi

echo ""
echo "======================================="
echo "Uninstallation Complete!"
echo "======================================="
echo ""
echo "The desklet has been removed from your system."
echo "You may need to restart Cinnamon (Alt+F2, type 'r', press Enter)"
echo ""
echo "Thank you for using Nvidia Profile Switcher!"
echo ""
