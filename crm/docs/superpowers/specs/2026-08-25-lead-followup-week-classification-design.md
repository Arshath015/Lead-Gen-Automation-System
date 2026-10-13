---
name: Lead follow-up week classification
description: Preserve original lead dates while classifying scheduled follow-ups in their current calendar week.
---

# Lead Follow-Up Week Classification

## Goal

Keep a lead's original date unchanged while showing it in the calendar week of
its latest scheduled follow-up.

For example, a lead created or first recorded on August 5 stays dated August 5.
When a follow-up is scheduled for August 27, date-range and week views classify
the lead using August 27 instead. If it is subsequently rescheduled, the new
scheduled date becomes its current classification date.

## Existing Model

The `leads` table already has:

- `createdAt`: the original lead date used by existing date filters
- `nextFollowUpAt`: a nullable field suitable for the lead's current
  follow-up/classification date

No database migration is needed.

## Behavior

### Original date

- `createdAt` is never written by follow-up create, edit, or reschedule flows.
- The request does not introduce a new first-outreach column.
- Existing leads that have no scheduled follow-up retain current date filtering
  behavior through the `createdAt` fallback.

### Effective classification date

For lead-list and dashboard date-range classification, use:

```text
nextFollowUpAt ?? createdAt
```

This only changes week/date classification. It does not change the lead's
displayed original date or the existing due/overdue follow-up widgets.

### Follow-up writes

- Creating a follow-up sets the related lead's `nextFollowUpAt` to the scheduled
  timestamp.
- Editing or rescheduling a follow-up with a new scheduled timestamp updates
  `nextFollowUpAt` to that new timestamp.
- Updating a follow-up's notes or status without a new timestamp does not alter
  the classification date.

## Scope

Update the server-side lead and dashboard date-range paths that currently filter
only by `leads.createdAt`. Do not change:

- The original lead timestamp
- The follow-up due/overdue card logic, which already queries pending follow-ups
  directly
- The database schema or existing data

## Validation

Add focused regression coverage for the effective-date rule and verify:

1. A scheduled follow-up moves an older lead into the follow-up's week.
2. `createdAt` remains unchanged when scheduling or rescheduling.
3. A later follow-up date becomes the new classification date.
4. A lead without `nextFollowUpAt` still classifies by `createdAt`.
5. Relevant tests, typecheck, and production builds succeed.