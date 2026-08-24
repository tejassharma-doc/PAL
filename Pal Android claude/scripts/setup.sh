#!/usr/bin/env bash
# PAL Health Android — first-time setup script (Linux / macOS / WSL)
# Run from the project root: bash scripts/setup.sh
#
# What this script does:
#   1. Downloads gradle-wrapper.jar (required for ./gradlew commands)
#   2. Generates PNG launcher icons for API 24-25 devices (requires Python + Pillow)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER_DIR="$PROJECT_ROOT/android/gradle/wrapper"
WRAPPER_JAR="$WRAPPER_DIR/gradle-wrapper.jar"
JAR_URL="https://raw.githubusercontent.com/facebook/react-native/main/template/android/gradle/wrapper/gradle-wrapper.jar"

echo ""
echo "========================================"
echo " PAL Health Android — setup"
echo "========================================"
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# STEP 1 — gradle-wrapper.jar
# ──────────────────────────────────────────────────────────────────────────────

if [[ -f "$WRAPPER_JAR" ]]; then
    echo "[OK] gradle-wrapper.jar already exists. Skipping download."
else
    echo "[1/2] Downloading gradle-wrapper.jar ..."
    mkdir -p "$WRAPPER_DIR"

    # Method A: use locally installed Gradle
    if command -v gradle &>/dev/null; then
        echo "     Gradle found — running 'gradle wrapper' ..."
        pushd "$PROJECT_ROOT/android" >/dev/null
        gradle wrapper --gradle-version 8.10.2 --distribution-type all
        popd >/dev/null

        if [[ -f "$WRAPPER_JAR" ]]; then
            echo "[OK] gradle-wrapper.jar generated via local Gradle."
        else
            echo "     gradle wrapper output didn't produce the JAR — falling back to download."
        fi
    fi

    # Method B: download directly (curl or wget)
    if [[ ! -f "$WRAPPER_JAR" ]]; then
        if command -v curl &>/dev/null; then
            echo "     Downloading via curl ..."
            curl -fsSL "$JAR_URL" -o "$WRAPPER_JAR"
        elif command -v wget &>/dev/null; then
            echo "     Downloading via wget ..."
            wget -q "$JAR_URL" -O "$WRAPPER_JAR"
        else
            echo ""
            echo "[ERROR] Neither curl nor wget is available."
            echo "  Install curl:  sudo apt install curl  (Debian/Ubuntu)"
            echo "                 brew install curl       (macOS)"
            echo ""
            echo "  Or copy gradle-wrapper.jar from an existing Android Studio installation."
            echo ""
        fi
    fi

    if [[ -f "$WRAPPER_JAR" ]]; then
        echo "[OK] gradle-wrapper.jar ready."
        # Make gradlew executable
        chmod +x "$PROJECT_ROOT/android/gradlew"
    fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# STEP 2 — PNG launcher icons (API 24-25 fallbacks)
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "[2/2] Generating PNG launcher icons for API 24-25 devices ..."

PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null; then
    PYTHON="python"
fi

if [[ -n "$PYTHON" ]]; then
    # Install Pillow if not present, then generate icons
    if ! "$PYTHON" -c "from PIL import Image" &>/dev/null 2>&1; then
        echo "     Pillow not found — installing ..."
        "$PYTHON" -m pip install Pillow --quiet
    fi
    "$PYTHON" "$PROJECT_ROOT/scripts/generate_icons.py"
else
    echo "     Python not found. Skipping PNG icon generation."
    echo "     API 26+ icons are already in mipmap-anydpi-v26/ and will work fine."
    echo "     To generate API 24-25 fallbacks later:"
    echo "       pip install Pillow"
    echo "       python scripts/generate_icons.py"
fi

echo ""
echo "========================================"
echo " Setup complete."
echo ""
echo " Next steps:"
echo "   1. npm install"
echo "   2. cp .env.example .env  (fill in PAL_API_URL)"
echo "   3. npm run android"
echo "========================================"
echo ""
