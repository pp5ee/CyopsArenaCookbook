#!/usr/bin/env bash
# secret-guard.sh — reject any commit that would add a tracked .env file.
# Hooked into .husky/pre-commit.
set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
# Allow only the bare .env (or any .env.<something>) to be a hard error.
# .env.example is allowed because it's a template, not a secret.
if echo "$STAGED" | grep -E '(^|/)\.env$'; then
  echo "secret-guard: refusing to commit a .env file. Use .env.example for templates." >&2
  exit 1
fi
# Block other env-like files that might carry secrets (.env.local, .env.production, etc.)
if echo "$STAGED" | grep -E '(^|/)\.env\.(local|production|staging|development|test|prod|dev)$'; then
  echo "secret-guard: refusing to commit a .env.<env> file." >&2
  exit 1
fi

# Block common secret file patterns too
if echo "$STAGED" | grep -E '(id_rsa|id_dsa|id_ed25519|\.pem$|\.key$)'; then
  echo "secret-guard: refusing to commit a private-key file." >&2
  exit 1
fi

exit 0
