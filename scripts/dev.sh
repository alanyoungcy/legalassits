#!/usr/bin/env bash
# Capco Contract Assists — start / stop local API + web
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT}/.run"
LOG_DIR="${ROOT}/.run/logs"
API_PID="${RUN_DIR}/api.pid"
WEB_PID="${RUN_DIR}/web.pid"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
API_HOST="${API_HOST:-127.0.0.1}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [target]

Commands:
  start   [all|api|web|infra]   Start services (default: all)
  stop    [all|api|web|infra]   Stop services (default: all)
  restart [all|api|web|infra]   Restart services
  status                        Show process / health status

Examples:
  ./scripts/dev.sh start
  ./scripts/dev.sh stop
  ./scripts/dev.sh start api
  ./scripts/dev.sh start infra
EOF
}

is_pid_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

port_pids() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

kill_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port")"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(port_pids "$port")"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

ensure_backend_venv() {
  if [[ ! -x "${ROOT}/backend/.venv/bin/uvicorn" ]]; then
    echo "Missing backend/.venv — create it first:"
    echo "  cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
  fi
}

ensure_frontend_deps() {
  if [[ ! -d "${ROOT}/frontend/node_modules" ]]; then
    echo "Installing frontend dependencies…"
    (cd "${ROOT}/frontend" && npm install)
  fi
}

start_api() {
  if is_pid_running "$API_PID" || [[ -n "$(port_pids "$API_PORT")" ]]; then
    echo "API already running on :${API_PORT}"
    return 0
  fi
  ensure_backend_venv
  echo "Starting API on http://${API_HOST}:${API_PORT}…"
  (
    cd "${ROOT}/backend"
    # Quote values with spaces so `source .env` is safe (e.g. COPILOT_NAME="Capco Wayne")
    if [[ -f "${ROOT}/.env" ]]; then
      set -a
      # shellcheck disable=SC1091
      source "${ROOT}/.env"
      set +a
    fi
    nohup .venv/bin/uvicorn app.main:app --host "$API_HOST" --port "$API_PORT" \
      >"${LOG_DIR}/api.log" 2>&1 &
    echo $! >"$API_PID"
  )
  sleep 0.8
  if curl -sf "http://${API_HOST}:${API_PORT}/healthz" >/dev/null; then
    echo "API ready  → http://${API_HOST}:${API_PORT}/docs"
  else
    echo "API started (pid $(cat "$API_PID")) — check ${LOG_DIR}/api.log if healthz fails"
  fi
}

start_web() {
  if is_pid_running "$WEB_PID" || [[ -n "$(port_pids "$WEB_PORT")" ]]; then
    echo "Web already running on :${WEB_PORT}"
    return 0
  fi
  ensure_frontend_deps
  echo "Starting web on http://127.0.0.1:${WEB_PORT}…"
  (
    cd "${ROOT}/frontend"
    nohup npm run dev -- --port "$WEB_PORT" >"${LOG_DIR}/web.log" 2>&1 &
    echo $! >"$WEB_PID"
  )
  sleep 1.2
  echo "Web ready → http://127.0.0.1:${WEB_PORT}"
}

start_infra() {
  echo "Starting Docker infra (postgres, etc.)…"
  (cd "$ROOT" && docker compose up -d)
}

stop_api() {
  echo "Stopping API…"
  if is_pid_running "$API_PID"; then
    kill "$(cat "$API_PID")" 2>/dev/null || true
  fi
  kill_port "$API_PORT"
  rm -f "$API_PID"
  echo "API stopped"
}

stop_web() {
  echo "Stopping web…"
  if is_pid_running "$WEB_PID"; then
    local pid
    pid="$(cat "$WEB_PID")"
    kill "$pid" 2>/dev/null || true
    # Next often spawns children; clear the port too
  fi
  kill_port "$WEB_PORT"
  rm -f "$WEB_PID"
  echo "Web stopped"
}

stop_infra() {
  echo "Stopping Docker infra…"
  (cd "$ROOT" && docker compose down)
}

show_status() {
  echo "Capco Contract Assists"
  echo "----------------------"
  if [[ -n "$(port_pids "$API_PORT")" ]] && curl -sf "http://${API_HOST}:${API_PORT}/healthz" >/dev/null; then
    echo "API  : running  http://${API_HOST}:${API_PORT}  (healthz ok)"
  elif [[ -n "$(port_pids "$API_PORT")" ]]; then
    echo "API  : listening on :${API_PORT} (healthz not ok — see ${LOG_DIR}/api.log)"
  else
    echo "API  : stopped"
  fi

  if [[ -n "$(port_pids "$WEB_PORT")" ]]; then
    echo "Web  : running  http://127.0.0.1:${WEB_PORT}"
  else
    echo "Web  : stopped"
  fi

  if command -v docker >/dev/null 2>&1; then
    local ps
    ps="$(cd "$ROOT" && docker compose ps --status running --format '{{.Name}}' 2>/dev/null | tr '\n' ' ' || true)"
    if [[ -n "${ps// /}" ]]; then
      echo "Infra: running  ${ps}"
    else
      echo "Infra: stopped (or docker unavailable)"
    fi
  fi
}

cmd="${1:-}"
target="${2:-all}"

case "$cmd" in
  start)
    case "$target" in
      all) start_api; start_web ;;
      api) start_api ;;
      web) start_web ;;
      infra) start_infra ;;
      *) usage; exit 1 ;;
    esac
    ;;
  stop)
    case "$target" in
      all) stop_web; stop_api ;;
      api) stop_api ;;
      web) stop_web ;;
      infra) stop_infra ;;
      *) usage; exit 1 ;;
    esac
    ;;
  restart)
    case "$target" in
      all) stop_web; stop_api; start_api; start_web ;;
      api) stop_api; start_api ;;
      web) stop_web; start_web ;;
      infra) stop_infra; start_infra ;;
      *) usage; exit 1 ;;
    esac
    ;;
  status)
    show_status
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
