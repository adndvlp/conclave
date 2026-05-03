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
echo "  🔑 Conclave — Multi-LLM Collaborative AI"
echo -e "${NC}"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  mingw*|msys*|cygwin*) OS="windows" ;;
  *)
    # Windows via WSL or native git bash reports MINGW64
    if echo "$OS" | grep -qi "mingw\|msys\|cygwin"; then
      OS="windows"
    elif [ -n "$WINDIR" ] || [ -n "$WINDIR" ]; then
      OS="windows"
    else
      echo -e "${RED}Unsupported OS: $OS${NC}"
      echo -e "${DIM}Windows users: use WSL (wsl --install) or Git Bash${NC}"
      exit 1
    fi
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo -e "${RED}Unsupported arch: $ARCH${NC}"; exit 1 ;;
esac

TARGET="$OS-$ARCH"
INSTALL_DIR="${HOME}/.conclave"

# Pick best bin directory: prefer one already in PATH
BIN_DIR=""
for dir in "/usr/local/bin" "$HOME/.local/bin" "$HOME/bin"; do
  if [ -d "$dir" ] && [ -w "$dir" ] && echo "$PATH" | grep -q "$dir"; then
    BIN_DIR="$dir"; break
  fi
done
[ -z "$BIN_DIR" ] && BIN_DIR="${HOME}/.local/bin"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
BIN="$BIN_DIR/conclave"

# Get latest release
echo -e "${DIM}Fetching latest release...${NC}"
RELEASE=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || echo "")
TAG=$(echo "$RELEASE" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')

if [ -n "$TAG" ]; then
  # Windows uses .zip, others use .tar.gz
  if [ "$OS" = "windows" ]; then
    EXTS=".zip .zip .zip"
  else
    EXTS=".tar.gz .tar.gz .tar.gz"
  fi

  # Try exact match first, then fallback patterns
  for pattern in "conclave-${TARGET}${EXTS%% *}" "conclave-${TARGET}-baseline${EXTS%% *}" "conclave-windows-${ARCH}.zip"; do
    URL=$(echo "$RELEASE" | grep '"browser_download_url"' | grep "$pattern" | head -1 | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')
    [ -n "$URL" ] && break
  done

  if [ -n "$URL" ]; then
    echo -e "${DIM}Downloading Conclave ${TARGET}...${NC}"
    if echo "$URL" | grep -q '\.zip$'; then
      curl -sL "$URL" -o "$INSTALL_DIR/conclave.zip"
      unzip -qo "$INSTALL_DIR/conclave.zip" -d "$INSTALL_DIR"
      rm -f "$INSTALL_DIR/conclave.zip"
    else
      curl -sL "$URL" -o "$INSTALL_DIR/conclave.tar.gz"
      tar -xzf "$INSTALL_DIR/conclave.tar.gz" -C "$INSTALL_DIR"
      rm -f "$INSTALL_DIR/conclave.tar.gz"
    fi
    cp "$INSTALL_DIR/conclave" "$BIN" 2>/dev/null || cp "$INSTALL_DIR/conclave.exe" "$BIN.exe" 2>/dev/null
    chmod +x "$BIN" 2>/dev/null || true
    chmod +x "$BIN.exe" 2>/dev/null || true
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

# Add to PATH for this session (immediate use)
export PATH="$BIN_DIR:$PATH"

# Add to shell config (future sessions)
case $(basename "$SHELL") in
  fish)
    grep -q "$BIN_DIR" "$HOME/.config/fish/config.fish" 2>/dev/null || echo "fish_add_path $BIN_DIR" >> "$HOME/.config/fish/config.fish"
    ;;
  zsh)
    grep -q "$BIN_DIR" "${ZDOTDIR:-$HOME}/.zshrc" 2>/dev/null || echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "${ZDOTDIR:-$HOME}/.zshrc"
    ;;
  *)
    grep -q "$BIN_DIR" "${HOME}/.bashrc" 2>/dev/null || echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "${HOME}/.bashrc"
    ;;
esac

echo ""
echo -e "  Run: ${GOLD}conclave${NC}"
echo ""

# If conclave is already in PATH from this session
if command -v conclave &>/dev/null; then
  echo -e "  ${DIM}Ready to go. Just type:${NC} ${GOLD}conclave${NC}"
else
  echo -e "  ${DIM}Run this or restart your terminal:${NC}"
  echo -e "  ${GOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
fi
