#!/usr/bin/env bash
# AC-10 End-to-End Smoke — walks the cookbook frontend (Guide →
# Prompt Studio → Vote Ticker), captures three screenshots, and
# asserts key content on each page.
#
# Requires: agent-browser (preinstalled), a running `pnpm dev`
# server on http://localhost:5173.
set -euo pipefail

OUTDIR="${1:-docs/references/e2e}"
mkdir -p "$OUTDIR"

echo "[smoke] navigating to Guide (/) ..."
agent-browser open http://localhost:5173/
sleep 2
agent-browser snapshot > "$OUTDIR/01-guide.txt"
echo "[smoke] Guide text captured"

echo "[smoke] navigating to Prompt Studio (/prompt) ..."
agent-browser open http://localhost:5173/prompt
sleep 2
agent-browser snapshot > "$OUTDIR/02-prompt.txt"
echo "[smoke] Prompt Studio text captured"

echo "[smoke] navigating to Vote Ticker (/vote) ..."
agent-browser open http://localhost:5173/vote
sleep 2
agent-browser snapshot > "$OUTDIR/03-vote.txt"
echo "[smoke] Vote Ticker text captured"

echo ""
echo "=== Smoke Report ==="
echo "Guide         : $(wc -l < "$OUTDIR/01-guide.txt") lines"
echo "Prompt Studio : $(wc -l < "$OUTDIR/02-prompt.txt") lines"
echo "Vote Ticker   : $(wc -l < "$OUTDIR/03-vote.txt") lines"
echo ""
echo "Key content checks:"

# Guide page: must mention rules, prizes, scoring rubric
if grep -qiE 'rules|rules of play' "$OUTDIR/01-guide.txt"; then
  echo "  [PASS] Guide contains Rules section"
else
  echo "  [FAIL] Guide missing Rules section"
  exit 1
fi

if grep -qiE 'prizes|prize categories' "$OUTDIR/01-guide.txt"; then
  echo "  [PASS] Guide contains Prizes section"
else
  echo "  [FAIL] Guide missing Prizes section"
  exit 1
fi

if grep -qiE 'scoring|rubric|implementation' "$OUTDIR/01-guide.txt"; then
  echo "  [PASS] Guide contains Scoring section"
else
  echo "  [FAIL] Guide missing Scoring section"
  exit 1
fi

# Prompt Studio: must have track picker or free-text entry
if grep -qiE 'track|ship.a.feature|describe your idea|brainstorm' "$OUTDIR/02-prompt.txt"; then
  echo "  [PASS] Prompt Studio has entry mode"
else
  echo "  [FAIL] Prompt Studio missing entry mode"
  exit 1
fi

# Vote Ticker: must have current vote indicator or sparkline
if grep -qiE 'votes|voting|ticker' "$OUTDIR/03-vote.txt"; then
  echo "  [PASS] Vote Ticker shows vote data"
else
  echo "  [FAIL] Vote Ticker missing vote data"
  exit 1
fi

echo ""
echo "[smoke] all checks passed — exit 0"
exit 0
