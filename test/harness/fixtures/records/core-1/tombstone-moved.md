---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "tombstone-moved"
fields:
  summary: "Moved to home"
  type: "event"
tombstone:
  type: "local-intent"
  annotation:
    kind: "moved"
    successor:
      collection: "https://dav.example.com/calendars/ren/home/"
      uid: "tombstone-moved"
normalization:
  core: 1
checksum: "4766c57a95b929f382075f4ca5d6f322434c389be266fd80997aaf4207c43858"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260302T140000Z
SUMMARY:Moved to home
UID:tombstone-moved
END:VEVENT
END:VCALENDAR
```
