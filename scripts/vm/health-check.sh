#!/usr/bin/env bash
# Health check for services on the VM: Docker (AI_Bulk), PM2 (dashboard + optional AI_Bulk), API, Dashboard, Postgres, Redis.
# Run on VM: bash scripts/vm/health-check.sh
# Or from Mac: ssh root@<VM_IP> 'bash -s' < scripts/vm/health-check.sh

set -e

BULK_API_URL="${BULK_API_URL:-http://127.0.0.1:3000}"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:3001}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"

ok()  { echo -e "  \033[0;32m✓\033[0m $1"; }
fail() { echo -e "  \033[0;31m✗\033[0m $1"; }
warn() { echo -e "  \033[0;33m?\033[0m $1"; }

echo ""
echo "=== Docker (AI_Bulk stack) ==="
if command -v docker >/dev/null 2>&1; then
  if docker ps >/dev/null 2>&1; then
    docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | head -20
    ok "Docker containers running"
  else
    fail "Docker not running or no permission"
  fi
else
  warn "Docker not installed (skip if using PM2 only)"
fi

echo ""
echo "=== PM2 processes ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null || warn "pm2 list failed"
else
  warn "PM2 not installed"
fi

echo ""
echo "=== Bulk API (port 3000) ==="
if curl -sf --connect-timeout 3 "${BULK_API_URL}/healthz" >/dev/null 2>&1; then
  ok "Bulk API ${BULK_API_URL}/healthz"
else
  fail "Bulk API not reachable at ${BULK_API_URL}/healthz (is the app/container running?)"
fi

echo ""
echo "=== Dashboard (port 3001) ==="
if curl -sf --connect-timeout 3 "${DASHBOARD_URL}/api/products" >/dev/null 2>&1 || \
   curl -sf --connect-timeout 3 "${DASHBOARD_URL}/" >/dev/null 2>&1; then
  ok "Dashboard ${DASHBOARD_URL}"
else
  fail "Dashboard not reachable at ${DASHBOARD_URL} (is it running on 3001?)"
fi

echo ""
echo "=== Redis ==="
if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
    ok "Redis ${REDIS_HOST}:${REDIS_PORT}"
  else
    fail "Redis not responding at ${REDIS_HOST}:${REDIS_PORT}"
  fi
else
  if curl -sf --connect-timeout 2 "http://${REDIS_HOST}:${REDIS_PORT}" 2>/dev/null; then
    warn "Redis port open (redis-cli not installed to ping)"
  else
    warn "Redis not checked (install redis-cli or ensure REDIS_URL is correct)"
  fi
fi

echo ""
echo "=== PostgreSQL ==="
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    ok "PostgreSQL ${PG_HOST}:${PG_PORT}"
  else
    fail "PostgreSQL not ready at ${PG_HOST}:${PG_PORT}"
  fi
else
  if nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null; then
    ok "PostgreSQL port ${PG_HOST}:${PG_PORT} open (pg_isready not installed)"
  else
    warn "PostgreSQL not checked (install pg_isready or netcat)"
  fi
fi

echo ""
