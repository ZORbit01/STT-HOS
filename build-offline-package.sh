#!/usr/bin/env bash
# Builds a ready-to-go, versioned offline deployment package for the OR Tracking System.
#
# Run this INSIDE WSL (Ubuntu), where Docker actually runs, with internet access.
# Builds all images, tags them with a version (git commit + timestamp), saves them
# as compressed tarballs, and assembles a self-contained folder that can be copied
# via USB and later pushed to the offline Debian Hyper-V server
# (see push-to-server.sh / install.sh).
#
# Output folder contains:
#   images/*.tar.gz       docker images (postgres, backend, frontend)
#   docker-compose.yml    rewritten to use the pinned image tags (no "build:")
#   nginx/nginx.conf
#   backend/.env.example
#   install.sh            run on the Debian server to load images + start
#   VERSION.txt           version/commit/date manifest
#
# Usage:
#   ./build-offline-package.sh [-v VERSION] [--include-vosk-model]
#
#   -v VERSION            optional semantic version, e.g. v1.0.0
#   --include-vosk-model  bundle backend/vosk-model-small-en-us-0.15 (large, static;
#                          skipped by default since it's usually already on the server)

set -euo pipefail

VERSION=""
INCLUDE_VOSK=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -v|--version) VERSION="$2"; shift 2 ;;
        --include-vosk-model) INCLUDE_VOSK=1; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "======================================"
echo "  OR Tracking System - Offline Package Builder"
echo "======================================"
echo ""

# ── 1. Resolve version tag ────────────────────────────────────────────────────
echo "[1/6] Resolving version..."

COMMIT="nogit"
if git rev-parse --short HEAD >/dev/null 2>&1; then
    COMMIT="$(git rev-parse --short HEAD)"
fi

TIMESTAMP="$(date +%Y-%m-%d_%H%M)"

if [[ -n "$VERSION" ]]; then
    TAG="${VERSION}-${COMMIT}"
else
    TAG="${TIMESTAMP}-${COMMIT}"
fi

echo "  Tag: $TAG"

# ── 2. Prepare output folder ──────────────────────────────────────────────────
echo "[2/6] Preparing output folder..."

OUT_DIR="$PROJECT_ROOT/dist/or-tracking-offline_${TAG}"
IMAGES_DIR="$OUT_DIR/images"
NGINX_DIR="$OUT_DIR/nginx"
BACKEND_DIR="$OUT_DIR/backend"

rm -rf "$OUT_DIR"
mkdir -p "$IMAGES_DIR" "$NGINX_DIR" "$BACKEND_DIR"

echo "  $OUT_DIR"

# ── 3. Build images ───────────────────────────────────────────────────────────
echo "[3/6] Building images (this may take a few minutes)..."

BACKEND_IMAGE="or-backend:${TAG}"
FRONTEND_IMAGE="or-frontend:${TAG}"
POSTGRES_IMAGE="postgres:15-alpine"

docker build -t "$BACKEND_IMAGE" ./backend
docker build -t "$FRONTEND_IMAGE" ./frontend
docker pull "$POSTGRES_IMAGE"

echo "  Images built/pulled."

# ── 4. Save images to tarballs ────────────────────────────────────────────────
echo "[4/6] Saving images to tarballs..."

save_image() {
    local image="$1" filename="$2"
    echo "  Saving $image -> ${filename}.gz"
    docker save "$image" | gzip > "$IMAGES_DIR/${filename}.gz"
}

save_image "$BACKEND_IMAGE"  "or-backend_${TAG}.tar"
save_image "$FRONTEND_IMAGE" "or-frontend_${TAG}.tar"
save_image "$POSTGRES_IMAGE" "postgres_15-alpine.tar"

echo "  Images saved."

# ── 5. Assemble compose file + configs ────────────────────────────────────────
echo "[5/6] Assembling compose file and configs..."

cat > "$OUT_DIR/docker-compose.yml" <<EOF
services:

  postgres:
    image: ${POSTGRES_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-oruser}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-orpassword}
      POSTGRES_DB: \${POSTGRES_DB:-or_tracking}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-oruser} -d \${POSTGRES_DB:-or_tracking}"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    image: ${BACKEND_IMAGE}
    restart: "no"
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgresql+asyncpg://\${POSTGRES_USER:-oruser}:\${POSTGRES_PASSWORD:-orpassword}@postgres:5432/\${POSTGRES_DB:-or_tracking}
    command: ["alembic", "upgrade", "head"]
    depends_on:
      postgres:
        condition: service_healthy

  init-admin:
    image: ${BACKEND_IMAGE}
    restart: "no"
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgresql+asyncpg://\${POSTGRES_USER:-oruser}:\${POSTGRES_PASSWORD:-orpassword}@postgres:5432/\${POSTGRES_DB:-or_tracking}
    command: ["python", "-m", "app.bootstrap_admin"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy

  backend:
    image: ${BACKEND_IMAGE}
    restart: unless-stopped
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgresql+asyncpg://\${POSTGRES_USER:-oruser}:\${POSTGRES_PASSWORD:-orpassword}@postgres:5432/\${POSTGRES_DB:-or_tracking}
    volumes:
      - ./backend/vosk-model-small-en-us-0.15:/app/vosk-model-small-en-us-0.15:ro
    expose:
      - "8000"
    healthcheck:
      test: ["CMD-SHELL", "python -c \\"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\\""]
      interval: 10s
      timeout: 5s
      retries: 5
    depends_on:
      init-admin:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy

  frontend:
    image: ${FRONTEND_IMAGE}
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      backend:
        condition: service_healthy

volumes:
  pgdata:
EOF

cp "$PROJECT_ROOT/nginx/nginx.conf" "$NGINX_DIR/nginx.conf"
cp "$PROJECT_ROOT/backend/.env.example" "$BACKEND_DIR/.env.example"

if [[ "$INCLUDE_VOSK" -eq 1 ]]; then
    echo "  Copying vosk model (this is large, may take a while)..."
    cp -r "$PROJECT_ROOT/backend/vosk-model-small-en-us-0.15" "$BACKEND_DIR/vosk-model-small-en-us-0.15"
else
    mkdir -p "$BACKEND_DIR/vosk-model-small-en-us-0.15"
    echo "Copy the vosk-model-small-en-us-0.15 folder here if not already present on the server." \
        > "$BACKEND_DIR/vosk-model-small-en-us-0.15/PLACE_MODEL_HERE.txt"
fi

cat > "$OUT_DIR/install.sh" <<'EOF'
#!/usr/bin/env bash
# Loads offline images and starts the OR Tracking System stack.
# Run this ON the Debian Hyper-V server, from inside the extracted package folder.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Loading Docker images..."
for f in images/*.tar.gz; do
    echo "  Loading $f"
    gunzip -c "$f" | docker load
done

if [ ! -f backend/.env ]; then
    echo "==> Creating backend/.env from .env.example"
    cp backend/.env.example backend/.env
    echo "    IMPORTANT: edit backend/.env and set SECRET_KEY and ADMIN_PASSWORD before going live."
fi

echo "==> Starting stack..."
docker compose up -d

echo "==> Done. Check status with: docker compose ps"
EOF
chmod +x "$OUT_DIR/install.sh"

cat > "$OUT_DIR/VERSION.txt" <<EOF
OR Tracking System - Offline Package
Tag:        $TAG
Commit:     $COMMIT
Built:      $(date "+%Y-%m-%d %H:%M:%S %z")
Images:
  - $BACKEND_IMAGE
  - $FRONTEND_IMAGE
  - $POSTGRES_IMAGE
EOF

echo "  Configs assembled."

# ── 6. Summary ─────────────────────────────────────────────────────────────
echo "[6/6] Done."
echo ""
echo "Package ready at:"
echo "  $OUT_DIR"
echo ""
echo "Next steps:"
echo "  1. Copy this folder to a USB drive."
echo "  2. On the Windows client, copy it off the USB, then run push-to-server.sh"
echo "     (or push-to-server.ps1) to send it to the Debian server over SSH and install it."
echo ""
