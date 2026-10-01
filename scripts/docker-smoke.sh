#!/usr/bin/env bash
# Builds the repository Dockerfile and runs the synthetic smoke INSIDE the image with the network disabled.
# Optional (needs Docker); it is not part of scripts/verify-quality.sh. Exits non-zero on any mismatch.
#
#   bash scripts/docker-smoke.sh [image-tag]
#
# The container is a throwaway (--rm); the script never touches other containers or images.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
TAG="${1:-proofgate:smoke}"
FAILED=0

check() { # check <description> <expected exit> <expected text or ""> <actual exit> <output>
  local ok=1
  [ "$4" -eq "$2" ] || ok=0
  if [ -n "$3" ] && ! printf '%s' "$5" | grep -qF -- "$3"; then ok=0; fi
  if [ "$ok" -eq 1 ]; then echo "ok   $1"; else echo "FAIL $1 (exit $4, expected $2, text '$3')"; printf '%s\n' "$5" | head -20; FAILED=$((FAILED + 1)); fi
}

echo "docker smoke: building $TAG"
docker build -t "$TAG" . || { echo "FAIL docker build"; exit 1; }
D=/opt/proofgate/fixtures/demo
run() { docker run --rm --network none "$TAG" "$@" 2>&1; }

out=$(run --version); check "image reports its version" 0 "0.1.0" $? "$out"
out=$(run evaluate --manifest $D/happy/requirements.yaml --receipts $D/happy/receipts --revisions $D/happy/revisions.json --now 2026-09-29T12:00:00Z); check "happy path exits 0 with the network disabled" 0 "verdict: ACCEPTED (exit 0)" $? "$out"
out=$(run evaluate --manifest $D/unsatisfied/requirements.yaml --receipts $D/unsatisfied/receipts --revisions $D/unsatisfied/revisions.json --now 2026-09-29T12:00:00Z); check "planted problems exit 1" 1 "verdict: UNSATISFIED (exit 1)" $? "$out"
out=$(run evaluate --manifest $D/tampered/requirements.yaml --receipts $D/tampered/receipts --revisions $D/tampered/revisions.json --now 2026-09-29T12:00:00Z); check "tampered artifact exits 2 with a stable code" 2 "artifact_hash_mismatch" $? "$out"
out=$(run evaluate --manifest $D/duplicate/requirements.yaml --receipts $D/duplicate/receipts --revisions $D/duplicate/revisions.json --now 2026-09-29T12:00:00Z); check "duplicate requirement id exits 2 with a stable code" 2 "manifest_duplicate_requirement_id" $? "$out"

# Report, bundle export, verify, restore, re-evaluate and truncation, all inside one throwaway container.
out=$(docker run --rm --network none --entrypoint bash "$TAG" -c '
set -u
D=/opt/proofgate/fixtures/demo/happy
proofgate evaluate --manifest $D/requirements.yaml --receipts $D/receipts --revisions $D/revisions.json --output out/happy --now 2026-09-29T12:00:00Z > /dev/null || exit 10
ls out/happy | tr "\n" " "; echo
proofgate bundle export --report out/happy --manifest $D/requirements.yaml --receipts $D/receipts --revisions $D/revisions.json --output out/happy.pgbundle > /dev/null || exit 11
proofgate bundle verify out/happy.pgbundle || exit 12
proofgate bundle restore out/happy.pgbundle --output restored > /dev/null || exit 13
proofgate evaluate --manifest restored/manifest.json --receipts restored/receipts --revisions restored/revisions.json --output out/again --now 2026-09-29T12:00:00.000Z > /dev/null || exit 14
test "$(grep assessment_id out/happy/report.json)" = "$(grep assessment_id out/again/report.json)" && echo "assessment ids match" || exit 15
size=$(wc -c < out/happy.pgbundle); head -c $((size / 2)) out/happy.pgbundle > out/truncated.pgbundle
proofgate bundle restore out/truncated.pgbundle --output out/never 2>&1; echo "truncated restore exit $?"
test ! -e out/never && echo "nothing restored"
echo "user $(id -un)"
' 2>&1)
check "report, bundle export, verify, restore and reproduction work inside the container" 0 "assessment ids match" $? "$out"
check "a truncated bundle is refused inside the container" 0 "truncated restore exit 2" 0 "$out"
check "nothing is restored from a truncated bundle" 0 "nothing restored" 0 "$out"
check "the container runs unprivileged" 0 "user node" 0 "$out"
check "the report directory contains index.html, report.json and report.sha256" 0 "index.html report.json report.sha256" 0 "$out"

if [ "$FAILED" -eq 0 ]; then echo "docker smoke: PASS"; exit 0; fi
echo "docker smoke: FAIL ($FAILED check(s))"
exit 1
