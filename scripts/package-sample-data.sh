#!/usr/bin/env bash
# Packages the five sample CSVs into private/wellnesstrack_sample_data.zip
# for upload to the private Supabase Storage bucket "assessment-data".
set -euo pipefail
SRC="${1:-HPB_Interview_Materials/Sample Data Generator and Sample Data}"
OUT="private/wellnesstrack_sample_data.zip"
mkdir -p private
rm -f "$OUT"
( cd "$SRC" && zip -q -X "$OLDPWD/$OUT" users.csv daily_activity.csv sleep_logs.csv nutrition_logs.csv mental_health.csv )
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
