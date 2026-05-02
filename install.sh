#!/usr/bin/env bash
set -euo pipefail

# Conclave Installer — Multi-LLM Collaborative AI Agent
# Usage: curl -fsSL https://raw.githubusercontent.com/adndvlp/conclave/main/install.sh | bash

RED='\033[0;31m'
GOLD='\033[0;33m'
NC='\033[0m'
DIM='\033[0;2m'

REPO="adndvlp/conclave"

echo -e "${RED}"
echo "  ⚡ Conclave — Multi-LLM Collaborative AI"
echo -e "${NC}"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *) echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo -e "${RED}Unsupported arch: $ARCH${NC}"; exit 1 ;;
esac

TARGET="$OS-$ARCH"
INSTALL_DIR="${HOME}/.conclave"
BIN_DIR="${HOME}/.local/bin"
BIN="$BIN_DIR/conclave"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Get latest release
echo -e "${DIM}Fetching latest release...${NC}"
RELEASE=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || echo "")
TAG=$(echo "$RELEASE" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')

if [ -n "$TAG" ]; then
  # Try exact match first, then fallback patterns
  for pattern in "conclave-${TARGET}.tar.gz" "conclave-${TARGET}-baseline.tar.gz" "conclave-$(echo $OS | sed 's/darwin/darwin/;s/linux/linux/')-${ARCH}.tar.gz"; do
    URL=$(echo "$RELEASE" | grep '"browser_download_url"' | grep "$pattern" | head -1 | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')
    [ -n "$URL" ] && break
  done

  if [ -n "$URL" ]; then
    echo -e "${DIM}Downloading Conclave ${TARGET}...${NC}"
    curl -sL "$URL" -o "$INSTALL_DIR/conclave.tar.gz"
    tar -xzf "$INSTALL_DIR/conclave.tar.gz" -C "$INSTALL_DIR"
    cp "$INSTALL_DIR/conclave" "$BIN"
    chmod +x "$BIN"
    rm -f "$INSTALL_DIR/conclave.tar.gz" "$INSTALL_DIR/conclave"
    echo -e "${GOLD}✓ Conclave $TAG installed${NC}"
  fi
fi

if [ ! -f "$BIN" ]; then
  # Fallback: install from source
  echo -e "${DIM}No binary for $TARGET, installing from source...${NC}"
  if ! command -v bun &>/dev/null; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  if ! command -v git &>/dev/null; then
    echo -e "${RED}git is required. Install it first.${NC}"
    exit 1
  fi
  [ -d "$INSTALL_DIR/src" ] || git clone "https://github.com/$REPO.git" "$INSTALL_DIR/src"
  cd "$INSTALL_DIR/src"
  git fetch origin main && git reset --hard origin/main
  bun install --frozen-lockfile
  # Create wrapper
  cat > "$BIN" << 'WRAPPER'
#!/usr/bin/env bash
cd "$HOME/.conclave/src" && bun run --cwd packages/opencode --conditions=browser src/index.ts "$@"
WRAPPER
  chmod +x "$BIN"
  echo -e "${GOLD}✓ Conclave installed from source${NC}"
fi

# Add to PATH
case $(basename "$SHELL") in
  fish)
    grep -q "$BIN_DIR" "$HOME/.config/fish/config.fish" 2>/dev/null || echo "fish_add_path $BIN_DIR" >> "$HOME/.config/fish/config.fish"
    ;;
  zsh)
    grep -q "$BIN_DIR" "${HOME}/.zshrc" 2>/dev/null || echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "${HOME}/.zshrc"
    ;;
  *)
    grep -q "$BIN_DIR" "${HOME}/.bashrc" 2>/dev/null || echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "${HOME}/.bashrc"
    ;;
esac

echo ""
echo -e "  Run: ${GOLD}conclave${NC}"
echo ""
echo -e "  ${DIM}Make sure ${BIN_DIR} is in your PATH. Restart your terminal or run:${NC}"
echo -e "  ${GOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
