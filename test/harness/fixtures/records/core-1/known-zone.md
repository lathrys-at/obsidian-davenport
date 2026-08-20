---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "known-zone"
fields:
  summary: "Standup"
  schedule:
    kind: "timed"
    start: "2026-03-02T09:00:00"
    end: "2026-03-02T10:00:00"
  timezone: "America/New_York"
  type: "event"
normalization:
  core: 1
  timezone: 1
checksum: "da9836c3ce1ad51a9f912d0224ff511c2a5bee377c30d90ab36a9a39c236d4bc"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VEVENT
DTEND;TZID=America/New_York:20260302T100000
DTSTART;TZID=America/New_York:20260302T090000
SUMMARY:Standup
UID:known-zone
END:VEVENT
END:VCALENDAR
```
