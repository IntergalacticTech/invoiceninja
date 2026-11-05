#!/usr/bin/env bash
# Smoke test for a deployed Invoice Ninja (VictoryCTO fork).
#
#   docs/victory/smoke.sh https://projects.victorycto.com [API_TOKEN]
#
# Without a token: health, OIDC config, the team app and the admin app's static entry.
# With a token (an admin's or a team member's X-API-TOKEN): the API, the victory endpoints
# and, for a non-admin token, that money comes back zeroed.
set -u

base="${1:?usage: smoke.sh https://host [API_TOKEN]}"
base="${base%/}"
token="${2:-}"
fail=0

check() { # name, expected-status, url, [grep pattern], [extra curl args...]
  local name="$1" want="$2" url="$3" pattern="${4:-}"
  shift 4 || shift $#
  local body status
  body="$(curl -sS -m 30 -o /dev/stdout -w '\n%{http_code}' -H 'X-Requested-With: XMLHttpRequest' "$@" "$url" 2>&1)"
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$status" != "$want" ]]; then
    printf 'FAIL  %-44s HTTP %s (wanted %s)\n' "$name" "$status" "$want"
    printf '      %s\n' "$(printf '%s' "$body" | head -c 300 | tr '\n' ' ')"
    fail=1
  elif [[ -n "$pattern" ]] && ! grep -Eq -- "$pattern" <<<"$body"; then
    printf 'FAIL  %-44s HTTP %s but no match for %s\n' "$name" "$status" "$pattern"
    printf '      %s\n' "$(printf '%s' "$body" | head -c 300 | tr '\n' ' ')"
    fail=1
  else
    printf 'ok    %-44s HTTP %s\n' "$name" "$status"
  fi
}

check "GET /health"                          200 "$base/health"
check "GET /api/v1/oidc/config (oidc_only)"  200 "$base/api/v1/oidc/config" '"oidc_only":\s*true'
check "GET /team/ (team app shell)"          200 "$base/team/" '/team/assets/'
check "POST /api/v1/login refused (OIDC only)" 403 "$base/api/v1/login" '' -X POST -H 'Content-Type: application/json' -d '{"email":"x@example.com","password":"x"}'

if [[ -z "$token" ]]; then
  echo "No token given: skipping the authenticated checks."
else
  auth=(-H "X-API-TOKEN: $token")
  today="$(date -u +%F)"
  month_ago="$(date -u -d '-30 days' +%F 2>/dev/null || date -u -v-30d +%F)"
  check "GET /api/v1/projects?per_page=1"     200 "$base/api/v1/projects?per_page=1&status=active" '"data"' "${auth[@]}"
  check "GET /api/v1/task_statuses"           200 "$base/api/v1/task_statuses?per_page=10" '"data"' "${auth[@]}"
  check "GET /api/v1/victory/time_entries"    200 "$base/api/v1/victory/time_entries?start_date=$month_ago&end_date=$today" '"data"' "${auth[@]}"
  check "GET /api/v1/victory/time_entries (bad range)" 422 "$base/api/v1/victory/time_entries?start_date=$today" '' "${auth[@]}"

  me="$(curl -sS -m 30 -H 'X-Requested-With: XMLHttpRequest' "${auth[@]}" -X POST "$base/api/v1/refresh_react" 2>/dev/null)"
  if grep -Eq '"is_admin":\s*true|"is_owner":\s*true' <<<"$me"; then
    echo "Token belongs to an admin/owner: admin_handoff should answer with a URL."
    check "POST /api/v1/victory/admin_handoff" 200 "$base/api/v1/victory/admin_handoff" '"url":\s*"https?:' "${auth[@]}" -X POST -H 'Content-Type: application/json' -d '{}'
  else
    echo "Token belongs to a team member: money must be zeroed and admin_handoff refused."
    projects="$(curl -sS -m 30 -H 'X-Requested-With: XMLHttpRequest' "${auth[@]}" "$base/api/v1/projects?per_page=50&status=active" 2>/dev/null)"
    if grep -Eq '"task_rate":\s*[1-9]|"budgeted_amount":\s*[1-9]' <<<"$projects"; then
      echo "FAIL  non-admin sees non-zero task_rate/budgeted_amount (HIDE_FINANCIALS_FROM_NON_ADMINS off?)"; fail=1
    else
      echo "ok    non-admin project rates and budget amounts are zero"
    fi
    check "POST /api/v1/victory/admin_handoff refused" 403 "$base/api/v1/victory/admin_handoff" '' "${auth[@]}" -X POST -H 'Content-Type: application/json' -d '{}'
  fi
fi

if [[ $fail -eq 0 ]]; then echo "All checks passed."; else echo "Some checks FAILED."; fi
exit $fail
