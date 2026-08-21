---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "unknown-zone"
fields:
  summary: "Shift"
  timezone: "Factory/Line 3"
  type: "event"
normalization:
  core: 1
  timezone: 1
checksum: "9f68ed4cc83af0a8e34c277408afd5b0cf75225b82f6f6de04bea6649d2da666"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Factory/Line 3
BEGIN:STANDARD
DTSTART:19700101T000000
TZNAME:F3
TZOFFSETFROM:+0130
TZOFFSETTO:+0130
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=Factory/Line 3:20260302T090000
SUMMARY:Shift
UID:unknown-zone
END:VEVENT
END:VCALENDAR
```
