# Agent 3: Shipment Tracking Updater

Same pattern as Agents 1 and 2 in the SBS Claude Agents Build Kit: Power Automate is the
hands, Claude is the brain, one HTTP step. Full Circle TMS is the system of record. Customer
updates send from michaelt@stibrokerage.com, where the SBS flows already live. Nothing reaches a customer without a person
approving it until the auto-send switch is turned on.

Files in this folder:

| File | What it is |
|---|---|
| `dist/0-provision-shipment-status-log.zip` | Import package. A run-once button flow that creates the Shipment Status Log list, its 18 columns, and the Needs Me and Sent today views. |
| `dist/1-shipment-tracking-claude.zip` | Import package. Flow 1, the tracking run. |
| `dist/2-shipment-tracking-send-approved.zip` | Import package. Flow 2, sends approved rows. |
| `dist/*.definition.json` | The same three flows as readable JSON, for review or a manual rebuild. |
| `build_package.py` | Generates everything in `dist/` from the two files below. Run it after editing either. |
| `TrackingSystemPrompt.txt` | Claude's instructions. Becomes the `TrackingSystemPrompt` variable in Flow 1. |
| `shipment_status_schema.json` | The structured-output schema and the Parse JSON schema. |
| `http_body.json` | The Claude HTTP body on its own, for reference. |

## Import, in order (about twenty minutes, all yours)

1. Power Automate, My flows, Import, Import Package (Legacy). Upload `0-provision-shipment-status-log.zip`. On the import screen, pick your existing SharePoint connection, then Import.
2. Open the imported flow, Run, and wait for it to finish. The Shipment Status Log list now exists on the SBS site with every column and both views. Turn the flow off afterwards; it is not needed again.
3. Import `1-shipment-tracking-claude.zip`. Pick your SharePoint and Office 365 Outlook connections. Open the flow in edit mode and paste three values: the Full Circle client ID and secret into the Get FC token step, and the Claude API key into the `x-api-key` header of the Claude step. All three steps have secure inputs on, so the values never show in run history. Save, then Turn on.
4. Import `2-shipment-tracking-send-approved.zip`, pick the same two connections, Turn on.
5. Wait for the next even hour between 6 AM and 6 PM Pacific, or press Run on Flow 1. The digest email arrives at michaelt@stibrokerage.com with the run's drafts.

If the legacy import refuses a package, the `*.definition.json` file beside it holds the whole flow; the fallback is to rebuild it step by step from that file, which is slower but needs nothing else.

## What it does, each run

Every two hours, 6 AM to 6 PM Pacific on weekdays, the flow pulls every in-transit load from
Full Circle, gathers the carrier emails about each one, asks Claude for a status class and a
draft customer update, and writes one row per changed load to a SharePoint list. Reps approve
rows from a Needs Me view; a second small flow sends the approved ones from the SBS mailbox
and stamps the row Sent. The list is the audit log.

## Flow 1: SBS Shipment Tracking (Claude)

Every Full Circle route below is in the published gateway spec at
gateway.api.fullcircletms.com/openapi/v1.json and in the Full Circle API Setup README on
the SBS SharePoint. The token step is a copy of the one in the Check Call and Contact
Audit flows.

1. **Trigger.** Recurrence, weekly schedule: Monday to Friday at 6, 8, 10, 12, 2, 4 and 6
   Pacific. Concurrency 1.
2. **Full Circle sign-in.** `POST /auth/token` with the client ID and secret. One token per
   run, good for 30 minutes.
3. **Active loads.** `GET /dispatch/manifests/active`: every manifest that is dispatched and
   not yet completed, each with its current position, next stop and ETA, last delivery,
   and the order numbers on it. This is the in-house tracking link's data as Full Circle
   holds it. In the same step, `POST /reports/f999` for the last 31 days, used only to look
   up each order's customer, customer reference, rep and booking contact email.
4. **For each manifest, for each order on it**, one at a time with a 2-second pause:
   1. `GET /tracktrace/byordernumber?orderNumber=<n>`: last known location with its
      timestamp, every stop with scheduled, arrived and departed times and status, order
      status, ETA, final scheduled delivery, and the reference numbers flagged for
      customer communication.
   2. Build `Load_context`: the F999 fields, the manifest position and next stop, and the
      full Track & Trace answer.
   3. SharePoint Get items on Shipment Status Log twice: the last row with SendState Sent
      for this order, and any row at all (to know if the order is new to the log).
   4. Office 365 Outlook, Send an HTTP request, on michaelt@stibrokerage.com and on
      RatesMBX@stibrokerage.com: Graph `messages?$search="<order number>"`, top 10, then
      keep the last 48 hours. Each becomes one evidence line (from, received, subject,
      preview).
   5. HTTP (premium) `POST https://api.anthropic.com/v1/messages`, Haiku 5.5, system prompt
      from the variable, the structured-output schema inline. Fixed retry, 3 tries, 30 s.
   6. Parse JSON on the first content block's text.
   7. **Condition:** `status_changed` is true, or no row exists yet for this order. Yes:
      Create item in Shipment Status Log. SendState is Draft when Claude produced a
      customer update, Logged when it did not. Drafts are counted and added to the digest;
      DELAYED and PROBLEM drafts are counted separately.
5. **End of run digest** to michaelt@stibrokerage.com when any drafts exist: a table of
   class, order, customer, reference, confidence and reason, with a link to the list. High
   importance when any DELAYED or PROBLEM row exists.

## Flow 2: SBS Shipment Tracking - Send Approved

1. **Trigger.** SharePoint, when an item is created or modified, on Shipment Status Log,
   with a trigger condition so it only fires when SendState is Approved and Recipient is
   not blank. The flow's own write-back sets SendState to Sent, so it cannot loop.
2. Office 365 Outlook, Send an email (V2) from michaelt@stibrokerage.com to `Recipient`,
   subject `DraftSubject`, body `DraftBody`.
3. Update item: SendState = Sent, SentAt = now, SentBy = whoever set Approved.
4. If the send fails: SendState = Held and the error goes into Reason, so nothing is lost
   silently.

## Shipment Status Log (new SharePoint list on the SBS site)

Created by the provision-once flow. The built-in Title column is renamed OrderNumber and
holds the Full Circle order number, matching how the other SBS lists key on Title.

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
- **Tracking comes from Full Circle, not carrier websites.** SBS tracks with its in-house
  tracking link inside Full Circle, and the gateway exposes that data two ways: the active
  manifests list (position, next stop, ETA per truck) and Track & Trace by order number
  (last known location with timestamp, every stop with status, ETA). Both are read-only
  routes on the same sign-in the other SBS flows use. Nothing to ask Full Circle for.
- **The exported flow JSON on SharePoint holds the Full Circle secret in plain text.** The
  Stage 2 backups of the Customer Contact Audit flow carry the client ID and secret inside
  the Get FC token step. Anyone with the SBS document library can read them. Worth
  rotating the secret with Full Circle and keeping future exports out of the shared
  library, or scrubbing that step before saving an export. The packages in this folder
  carry placeholders only.

## Cost

About 40 in-transit loads, 7 runs a day, one Haiku 5.5 call per load: roughly 280 calls a
day at under a tenth of a cent each, about $3 a month (approximate). The Console spend
limit from the Build Kit checklist is the backstop.

## Build state

| Piece | State |
|---|---|
| Design and flow steps | Written, Nov 17, against the published Full Circle gateway spec |
| Claude instructions, output schema | Written |
| Provision-once flow (list, columns, views) | Built as an import package |
| Flow 1 and Flow 2 | Built as import packages, no credentials inside |
| Mailbox for sending | michaelt@stibrokerage.com, confirmed |
| Tracking source | Full Circle active manifests plus Track & Trace by order number, confirmed from the spec |
| Imported and turned on | Not yet. Mick's twenty minutes, steps above |
| First live run reviewed | Not yet |
