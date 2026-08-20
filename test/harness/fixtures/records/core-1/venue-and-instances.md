---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "venue-and-instances"
fields:
  summary: "Retrospective"
  timezone: "America/New_York"
  rrule: "FREQ=WEEKLY;COUNT=3"
  type: "event"
venue:
  path: "Meetings/Retrospective.md"
  section: "Notes"
  contentHash: "c0ffee00"
materialization:
  "2026-03-02":
    path: "Daily/2026-03-02.md"
    section: "09:00"
    contentHash: "deadbeef"
  "2026-03-09":
    path: "Daily/2026-03-09.md"
  "2026-03-16":
    path: "Daily/2026-03-16.md"
    section: "09:00"
normalization:
  core: 1
  timezone: 1
checksum: "14c4afb9bbfd907aebc3acf0b8d5f48378cdf733b49823d530cde03ced9b9085"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20260302T090000
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Retrospective
UID:venue-and-instances
END:VEVENT
END:VCALENDAR
```
