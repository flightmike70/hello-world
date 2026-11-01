# Agent 3: Shipment Tracking Updater

Same pattern as Agents 1 and 2 in the SBS Claude Agents Build Kit: Power Automate is the
hands, Claude is the brain, one HTTP step. Full Circle TMS is the system of record. Customer
updates send from the SBS Outlook mailbox. Nothing reaches a customer without a person
approving it until the auto-send switch is turned on.

Files in this folder, ready to paste:

| File | Goes where |
|---|---|
| `TrackingSystemPrompt.txt` | The `TrackingSystemPrompt` variable (Initialize variable step). |
| `shipment_status_schema.json` | The Parse JSON step. The same schema is already inside `http_body.json`. |
| `http_body.json` | The Body field of the HTTP (premium) step. |

## What it does, each run

Every two hours, 6 AM to 6 PM Pacific on weekdays, the flow pulls every in-transit load from
Full Circle, gathers the carrier emails about each one, asks Claude for a status class and a
draft customer update, and writes one row per changed load to a SharePoint list. Reps approve
rows from a Needs Me view; a second small flow sends the approved ones from the SBS mailbox
and stamps the row Sent. The list is the audit log.

## Flow 1: SBS Shipment Tracking (Claude)

1. **Trigger.** Recurrence, every 2 hours, 6:00 AM to 6:00 PM Pacific, Monday to Friday.
   Concurrency 1.
2. **Full Circle sign-in.** POST /auth/token with the client ID and secret already stored
   for the FC Customer Contact Audit flow. One token per run.
3. **Active loads.** Pull the F999 Data Dump by Order for the last 30 days (the API caps a
   call at 31 days). Filter to orders whose status is dispatched, picked up or in transit
   and that have no actual delivery date. This is the same definition the Command Center
   uses for Loads in Transit.
4. **Apply to each load**, with a 2-second pause between loads:
   1. Set `LoadRow` to the F999 row as text: order number, customer, customer reference,
      rep, origin, destination, pickup appointment, planned delivery window, current
      status, last status time, booking contact name and email.
   2. SharePoint Get items on **Shipment Status Log**, filter OrderNumber eq this order and
      SendState eq Sent, order by SentAt desc, Top 1. Set `LastSentUpdate` to its class,
      ETA, location and SentAt, or the word `null`.
   3. Office 365 Outlook, Send an HTTP request to Graph, on each of the two mailboxes
      (michaelt@stibrokerage.com and RatesMBX@stibrokerage.com):
      `GET /users/{mailbox}/messages?$search="<order number>" OR "<customer reference>"&$top=10&$select=from,receivedDateTime,subject,body`.
      Keep messages from the last 48 hours, oldest first, HTML stripped, appended to
      `LoadEvidence` the same way Agent 1 builds `ThreadText`.
   4. HTTP (premium): POST https://api.anthropic.com/v1/messages. Headers as Agent 1
      (`x-api-key` from the `ClaudeApiKey` environment variable, `anthropic-version`,
      `content-type`). Body = `http_body.json`. Retry fixed interval, 3 retries, 30 seconds.
   5. Parse JSON on `body('HTTP')?['content'][0]?['text']` with `shipment_status_schema.json`.
   6. **Condition:** `status_changed` is true, or no row exists yet for this order.
      - Yes: Create item in Shipment Status Log (columns below). `SendState` = Draft when
        `customer_update` is not null, else Logged.
      - No: do nothing.
5. **End of run digest.** Send an email to michaelt@stibrokerage.com listing this run's
   Draft rows grouped by class, PROBLEM and DELAYED first, with a link to the Needs Me
   view. High importance when any PROBLEM or DELAYED row exists. Same shape as the
   2:30 PM FC Queue recap.

## Flow 2: SBS Shipment Tracking - Send Approved

1. **Trigger.** SharePoint, when an item is modified, on Shipment Status Log.
2. **Condition.** SendState changed to Approved.
3. Office 365 Outlook, Send an email (V2) from the SBS shared mailbox to `Recipient`,
   subject `DraftSubject`, body `DraftBody`, importance Normal.
4. Update item: SendState = Sent, SentAt = utcNow(), SentBy = the approver.

## Shipment Status Log (new SharePoint list on the SBS site)

| Column | Type | Notes |
|---|---|---|
| OrderNumber | Text | Full Circle order number |
| Customer | Text | |
| CustomerRef | Text | PO, BOL or customer order number |
| Rep | Text | Broker on the load |
| StatusClass | Choice | ON_TIME, AT_RISK, DELAYED, PROBLEM, UNKNOWN |
| Location | Text | |
| ETA | Date and time | |
| ETASource | Choice | full_circle, carrier_email, none |
| Evidence | Multiple lines | One line, with timestamp |
| Discrepancy | Multiple lines | Blank unless sources disagree |
| Confidence | Choice | high, medium, low |
| Reason | Multiple lines | For the rep, not the customer |
| Recipient | Text | Booking contact email from the F999 row, never from an email thread |
| DraftSubject | Text | |
| DraftBody | Multiple lines | |
| SendState | Choice | Draft, Approved, Sent, Held, Logged. Default Draft |
| SentAt | Date and time | |
| SentBy | Person | |
| RunId | Text | Flow run id, for tracing |

Views: **Needs Me** (SendState = Draft, PROBLEM and DELAYED first, newest first) and
**Sent today**.

## Sending rules

| Class | Phase 1 (now) | Phase 2 (after two clean weeks) |
|---|---|---|
| ON_TIME, confidence high | Rep bulk-approves from Needs Me | Flow sets Approved itself when `AutoSendOnTime` = true |
| ON_TIME, confidence medium or low | Rep approves one by one | Same |
| AT_RISK | Rep approves one by one | Same |
| DELAYED, PROBLEM | Rep or Mick approves one by one. Never auto-sent. | Never auto-sent |
| UNKNOWN | Logged only, no draft | Same |

## Two things worth knowing before building

- **Full Circle Track & Trace.** The Customer Contact Audit found Track & Trace turned on
  for only 12 of 440 customer contacts. That flag makes Full Circle email the contact on
  every status change, with no build at all. Turning it on by hand for the top customers is
  the fastest win here. This agent then handles what Track & Trace cannot: reading carrier
  email, spotting risk before the status changes, and writing a human-quality delay note.
- **No carrier websites.** Power Automate cannot browse a carrier's tracking page. In this
  version the evidence is Full Circle plus whatever lands in the two mailboxes: check-call
  replies, forwarded driver texts, and tracking-link emails from services like Macropoint
  or Trucker Tools. If SBS uses one of those services, say which and its emails become a
  first-class source.

## Cost

About 40 in-transit loads, 7 runs a day, one Haiku 5.5 call per load: roughly 280 calls a
day at under a tenth of a cent each, about $3 a month (approximate). The Console spend
limit from the Build Kit checklist is the backstop.

## Build state

| Piece | State |
|---|---|
| Design and flow steps | Written here, Nov 1 |
| Claude instructions | Written (`TrackingSystemPrompt.txt`) |
| Output schema | Written, valid JSON |
| HTTP body | Written |
| Shipment Status Log list | Not created |
| Flow 1 and Flow 2 | Not built |
| Mailbox for sending | Named as the SBS shared mailbox; confirm the address |
