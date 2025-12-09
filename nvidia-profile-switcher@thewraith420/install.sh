#!/bin/bash

# Nvidia Profile Switcher Desklet Installation Script
# Copyright (C) 2024 thewraith420

set -e  # Exit on error

DESKLET_UUID="nvidia-profile-switcher@thewraith420"
DESKLET_DIR="$HOME/.local/share/cinnamon/desklets/$DESKLET_UUID"
ICON_DIR="/usr/share/icons/hicolor/scalable/apps"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=================================="
echo "Nvidia Profile Switcher Installer"
echo "=================================="
echo ""

# Check if running on Cinnamon
if ! command -v cinnamon-settings &> /dev/null; then
    echo "ERROR: Cinnamon desktop environment not detected."
    echo "This desklet requires Cinnamon to be installed."
    exit 1
fi

# Check if prime-select is available
if ! command -v prime-select &> /dev/null; then
    echo "WARNING: prime-select command not found."
    echo "This desklet requires Nvidia Prime to be installed."
    echo "You may need to install nvidia-prime package."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "Installing desklet files..."

# Create desklet directory
mkdir -p "$DESKLET_DIR"

# Copy desklet files
cp "$SCRIPT_DIR/desklet.js" "$DESKLET_DIR/"
cp "$SCRIPT_DIR/metadata.json" "$DESKLET_DIR/"
cp "$SCRIPT_DIR/settings-schema.json" "$DESKLET_DIR/"

echo "✓ Desklet files installed to $DESKLET_DIR"

# Install icons (requires sudo)
echo ""
echo "Installing custom icons (requires sudo)..."

if [ -d "$SCRIPT_DIR/icons" ]; then
    sudo cp "$SCRIPT_DIR/icons/"*.svg "$ICON_DIR/" 2>/dev/null || {
        echo "WARNING: Could not install icons. You may need to run this script with sudo for icon installation."
        echo "Icons can be manually installed later with:"
        echo "  sudo cp icons/*.svg $ICON_DIR/"
    }
    
    # Update icon cache
    if command -v gtk-update-icon-cache &> /dev/null; then
        sudo gtk-update-icon-cache "$ICON_DIR/.." 2>/dev/null || true
        echo "✓ Icons installed and cache updated"
    fi
else
    echo "WARNING: Icons directory not found. Skipping icon installation."
fi

echo ""
echo "=================================="
echo "Installation Complete!"
echo "=================================="
echo ""
echo "To use the desklet:"
echo "1. Restart Cinnamon (Alt+F2, type 'r', press Enter)"
echo "2. Right-click on your desktop"
echo "3. Select 'Add Desklets'"
echo "4. Find 'Nvidia Profile Switcher' and add it"
echo ""
echo "To configure:"
echo "- Right-click the desklet and select 'Configure'"
echo ""
echo "Enjoy your new Nvidia Profile Switcher desklet!"
echo ""
