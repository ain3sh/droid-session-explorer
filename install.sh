#!/usr/bin/env bash
# dsx installer: curl -fsSL https://raw.githubusercontent.com/ain3sh/droid-session-explorer/main/install.sh | bash
set -euo pipefail

REPO="ain3sh/droid-session-explorer"
INSTALL_DIR="${DSX_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${DSX_VERSION:-latest}"

main() {
  local os arch target tmp url
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) die "unsupported OS: $(uname -s) (linux and macOS only for now)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  target="${os}-${arch}"

  if [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/dsx-${target}.tar.gz"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/dsx-${target}.tar.gz"
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "downloading dsx (${target}, ${VERSION})..."
  curl -fSL --progress-bar "$url" -o "$tmp/dsx.tar.gz"
  tar -xzf "$tmp/dsx.tar.gz" -C "$tmp"

  mkdir -p "$INSTALL_DIR"
  install -m 755 "$tmp/dsx" "$INSTALL_DIR/dsx"

  echo "installed $("$INSTALL_DIR/dsx" --version 2>/dev/null | head -1 || echo dsx) to $INSTALL_DIR/dsx"

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo
      echo "note: $INSTALL_DIR is not on your PATH. Add this to your shell rc:"
      echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac

  echo
  echo "run 'dsx' for the TUI, 'dsx --help' for the CLI."
  echo "first run indexes all sessions (a few minutes); after that it's instant."
}

die() {
  echo "install.sh: $1" >&2
  exit 1
}

main
