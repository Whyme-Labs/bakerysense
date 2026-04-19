#!/usr/bin/env bash
# Post-deploy smoke test. Usage: ./scripts/deploy-smoke.sh https://bakerysense-web.<account>.workers.dev
set -euo pipefail
URL="${1:?usage: deploy-smoke.sh <base-url>}"
echo "smoke-testing $URL"

check() {
  local name="$1" path="$2" expect="${3:-200}"
  local status
  status=$(curl -fsS -o /dev/null -w "%{http_code}" "$URL$path" || echo "000")
  if [[ "$status" == "$expect" ]]; then
    echo "  ✓ $name [$status]"
  else
    echo "  ✗ $name [$status != $expect]"
    return 1
  fi
}

check "landing"          "/"
check "signin page"      "/signin"
check "signup page"      "/signup"
check "jwks"             "/api/.well-known/jwks.json"
# Expect 401 without auth — auth endpoint is a public route but returns 401 to unauthenticated GETs
check "me (unauth=401)"  "/api/auth/me" "401"

echo "all checks passed"
