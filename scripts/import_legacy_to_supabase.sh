#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 ./scripts/export_legacy_seed.py
supabase db query --linked --file supabase/legacy_seed.sql

if [[ -f "assets/logos/company_logo.png" ]]; then
  supabase --experimental storage cp --linked assets/logos/company_logo.png ss:///branding/logos/company-logo.png
fi

for file in assets/invoices/*.pdf; do
  [[ -f "$file" ]] || continue
  supabase --experimental storage cp --linked "$file" "ss:///invoices/$(basename "$file")"
done
