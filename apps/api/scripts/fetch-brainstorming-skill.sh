#!/usr/bin/env bash
# Fetch the upstream Brainstorming skill text from obra/superpowers
# and cache it at apps/api/src/services/brainstorming-skill.md.
#
# Uses agent-browser to grab the rendered page (HTML or markdown),
# then extracts the markdown body and writes it to the canonical cache
# path. Run once at build time; the runtime LLM service reads the
# cached file. If the network is down, the embedded copy at
# brainstorming-skill.embedded.md is used instead.
#
# Usage:  bash apps/api/scripts/fetch-brainstorming-skill.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO_ROOT/apps/api/src/services/brainstorming-skill.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "[fetch-brainstorming-skill] agent-browser not found; using curl fallback" >&2
  curl -fsSL "$URL" -o "$TMP/skill.html"
  # Strip HTML to plain text via a tiny Python one-liner; the upstream
  # GitHub blob page has the markdown wrapped in <article>...</article>.
  python3 - "$TMP/skill.html" "$TMP/skill.md" <<'PY'
import html, re, sys
src = open(sys.argv[1], "r", encoding="utf-8").read()
m = re.search(r'<article[^>]*>(.*?)</article>', src, flags=re.S)
body = m.group(1) if m else src
# Drop tags, keep line breaks.
body = re.sub(r'<br\s*/?>', '\n', body, flags=re.I)
body = re.sub(r'</p>', '\n\n', body, flags=re.I)
body = re.sub(r'<[^>]+>', '', body)
body = html.unescape(body)
body = re.sub(r'\n{3,}', '\n\n', body)
open(sys.argv[2], "w", encoding="utf-8").write(body)
PY
else
  agent-browser open "$URL" --out "$TMP/page.html" >/dev/null
  python3 - "$TMP/page.html" "$TMP/skill.md" <<'PY'
import html, re, sys
src = open(sys.argv[1], "r", encoding="utf-8").read()
m = re.search(r'<article[^>]*>(.*?)</article>', src, flags=re.S)
body = m.group(1) if m else src
body = re.sub(r'<br\s*/?>', '\n', body, flags=re.I)
body = re.sub(r'</p>', '\n\n', body, flags=re.I)
body = re.sub(r'<[^>]+>', '', body)
body = html.unescape(body)
body = re.sub(r'\n{3,}', '\n\n', body)
open(sys.argv[2], "w", encoding="utf-8").write(body)
PY
fi

# Prepend a small front-matter so the cached file is self-describing.
{
  echo '---'
  echo 'name: brainstorming'
  echo 'source: https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md'
  echo 'fetched_at: '"$(date -u +%Y-%m-%d)"
  echo '---'
  echo
  cat "$TMP/skill.md"
} > "$OUT"

echo "[fetch-brainstorming-skill] wrote $OUT ($(wc -c < "$OUT") bytes)"
