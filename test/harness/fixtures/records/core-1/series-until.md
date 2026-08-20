---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "series-until"
fields:
  summary: "Weekly review"
  timezone: "America/New_York"
  rrule: "FREQ=WEEKLY;UNTIL=20260601T130000Z"
  type: "event"
normalization:
  core: 1
  timezone: 1
checksum: "4b33f7cf69c013016abe37b9ff38683db1965a4d638c379ef1af7d17aec93fda"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20260302T090000
RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z
SUMMARY:Weekly review
UID:series-until
END:VEVENT
END:VCALENDAR
```
