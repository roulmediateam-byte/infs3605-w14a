#!/usr/bin/env bash
# Fails if the repository holds a likely secret or a real-looking email address (NFR-04, NFR-06, CM-3).
# Allowed addresses use reserved example domains (example.com, *.example, *.test) or GitHub's noreply domain.
# Runs in CI on every pull request; run it locally before pushing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

files=$(git ls-files --cached --others --exclude-standard | grep -vE '^(package-lock\.json|scripts/check-hygiene\.sh)$' || true)
status=0

secret_patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'           # Claude API key
  'sb_secret_[A-Za-z0-9_-]{16,}'        # Supabase secret key
  'eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' # a signed JSON Web Token, such as a service_role key
  're_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}' # Resend API key
  'gh[pousr]_[A-Za-z0-9]{30,}'          # GitHub token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
for pattern in "${secret_patterns[@]}"; do
  if hits=$(printf '%s\n' "$files" | xargs -r grep -nIE -- "$pattern" 2>/dev/null); then
    echo "✗ Possible secret ($pattern):"
    echo "$hits" | sed 's/^/    /' | cut -c1-160
    status=1
  fi
done

emails=$(printf '%s\n' "$files" | xargs -r grep -hoIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' 2>/dev/null | sort -u || true)
bad=$(printf '%s\n' "$emails" | grep -vE '@(example\.com|[A-Za-z0-9.-]+\.example|[A-Za-z0-9.-]+\.test|users\.noreply\.github\.com)$' | grep -v '^$' || true)
if [ -n "$bad" ]; then
  echo "✗ Email addresses outside reserved example domains (use name@something.example instead):"
  echo "$bad" | sed 's/^/    /'
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "✓ No secrets or real-looking email addresses found"
fi
exit "$status"
