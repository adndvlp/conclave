#!/usr/bin/env bash
set -euo pipefail

# Conclave Install Script
# Multi-LLM collaborative coding agent — Fork of OpenCode

REPO="${CONCLAVE_REPO:-https://github.com/adndvlp/conclave.git}"
INSTALL_DIR="${CONCLAVE_INSTALL_DIR:-$HOME/.conclave}"
BRANCH="${CONCLAVE_BRANCH:-main}"

RED='\033[0;31m'
GOLD='\033[0;33m'
NC='\033[0m'

echo -e "${RED}"
echo "  ⚡ Conclave — Multi-LLM Collaborative Coding Agent"
echo -e "${NC}"
echo ""

# Check bun
if ! command -v bun &>/dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Check git
if ! command -v git &>/dev/null; then
  echo "git is required. Install it first."
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating Conclave in $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "Cloning Conclave into $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo "Installing dependencies..."
bun install

# Create symlink
BIN_DIR="${CONCLAVE_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/conclave" << 'EOF'
#!/usr/bin/env bash
cd "$HOME/.conclave" && bun run --cwd packages/opencode --conditions=browser src/index.ts "$@"
EOF
chmod +x "$BIN_DIR/conclave"

echo ""
echo -e "${RED}Conclave installed!${NC}"
echo "  Run: ${GOLD}conclave${NC}"
echo ""
echo "  Make sure ${BIN_DIR} is in your PATH:"
echo "  ${GOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
echo ""
echo "  Add to ~/.zshrc or ~/.bashrc for permanent access."
