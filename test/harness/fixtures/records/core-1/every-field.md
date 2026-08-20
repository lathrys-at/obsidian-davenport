---
collection: "https://dav.example.com/calendars/ren/work/"
uid: "every-field"
resource: "https://dav.example.com/calendars/ren/work/every-field.ics"
etag: "\"W/\\\"9\\\"\""
fields:
  summary: "Write the report"
  schedule:
    kind: "timed"
    start: "2026-03-02T14:00:00Z"
    duration: "2h30m"
  timezone: "UTC"
  rrule: "FREQ=MONTHLY;COUNT=4"
  type: "task"
  task: "[[Report]]"
  due: "2026-03-04T17:00:00Z"
  completed: "2026-03-04T16:12:00Z"
  priority: 2
  rsvp: "tentative"
  description: "Two paragraphs.\n\nThe second one."
  attachments:
    - "[[chart.png]]"
    - "https://example.com/brief.pdf"
  alarm: "-15m"
  location: "Room 3"
  categories:
    - "work"
    - "writing"
  class: "private"
  transp: "transparent"
  status: "confirmed"
renderHashes:
  description: "9f2c1a"
  attachments: "4b7e08"
normalization:
  core: 1
checksum: "180866a0d084d2a296d7ee85fd596bed36f0883328a5f8c427b7cfdde8c27fbb"
---

```ics
BEGIN:VCALENDAR
PRODID:-//Davenport//record golden//EN
VERSION:2.0
BEGIN:VTODO
CATEGORIES:work,writing
CLASS:PRIVATE
DESCRIPTION:Two paragraphs.\n\nThe second one.
DTSTART:20260302T140000Z
DUE:20260304T170000Z
LOCATION:Room 3
PRIORITY:2
STATUS:CONFIRMED
SUMMARY:Write the report
UID:every-field
END:VTODO
END:VCALENDAR
```
