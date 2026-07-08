#!/bin/bash
# Download a standalone `uv` binary into ./uv/ for bundling with the app.
#
# Replaces the old download-python.sh: uv (from Astral, who also maintain
# python-build-standalone) is used at runtime to install a standalone Python,
# create the venv, and install Datasette + plugins. See main.js bootstrap.
#
# Targets macOS Apple Silicon (arm64) only. Override UV_VERSION / UV_TARGET to
# fetch a different release or platform.
set -euo pipefail

UV_VERSION="${UV_VERSION:-0.11.28}"
UV_TARGET="${UV_TARGET:-aarch64-apple-darwin}"

cd "$(dirname "$0")"

if [ -x "uv/uv" ]; then
  echo "uv already present at ./uv/uv ($(./uv/uv --version 2>/dev/null || true))"
  exit 0
fi

filename="uv-${UV_TARGET}.tar.gz"
url="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${filename}"

echo "Downloading ${url}"
rm -rf uv uv-download
mkdir -p uv-download
curl -fsSL "$url" -o "uv-download/${filename}"

tar -xzf "uv-download/${filename}" -C uv-download
mkdir -p uv
# Archive extracts to uv-${UV_TARGET}/uv (and uvx)
cp "uv-download/uv-${UV_TARGET}/uv" uv/uv
cp "uv-download/uv-${UV_TARGET}/uvx" uv/uvx 2>/dev/null || true
chmod +x uv/uv uv/uvx 2>/dev/null || true
rm -rf uv-download

echo "Installed ./uv/uv ($(./uv/uv --version))"
