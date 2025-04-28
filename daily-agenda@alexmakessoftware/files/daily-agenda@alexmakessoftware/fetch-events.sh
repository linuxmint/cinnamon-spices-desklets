#!/bin/bash

ICS_FILE="$1"

if [[ -z "$ICS_FILE" || ! -f "$ICS_FILE" ]]; then
  echo "No valid .ics file"
  exit 1
fi

# Today's date
TODAY=$(date +%Y%m%d)

# Extract today's events
grep -A 10 "^BEGIN:VEVENT" "$ICS_FILE" | \
    awk "/^DTSTART.*$TODAY/" RS= | \
    grep -E '^SUMMARY|^DTSTART' | \
    sed 's/^SUMMARY://; s/^DTSTART.*://; s/T.*//' || echo "No events today"
