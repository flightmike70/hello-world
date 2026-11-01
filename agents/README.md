# Agents

Agent definitions for Sterling Brokerage Services (SBS) tooling.

| File | What it is |
|---|---|
| `shipment-tracking-updater.yaml` | Shipment Tracking Updater as originally written. |
| `shipment-tracking-updater.proposed.yaml` | Proposed revision of the same agent. Not yet approved. |

## What the proposed revision changes and why

1. **No guessing at accounts.** The original lets the agent pick "the most plausible"
   mailbox or TMS instance on its own. For a customer-facing agent that is the single
   biggest way to send the wrong update to the wrong person. The revision makes the
   agent ask once, then remember.
2. **Draft first, send on approval.** The original only asks before sending when there is
   a "significant" problem, with no definition of significant. The revision defines four
   statuses and makes every delay or problem message require your approval of that
   specific message. Routine on-time updates go out after a batch approval.
3. **Named sources of truth.** The original starts from a "Manifest screen in the FC
   system", which does not describe how SBS operates. The revision names Full Circle TMS
   as the single system of record (Aljex is retired), then the carrier tracking link,
   then Outlook email, in that order, and requires the agent to report disagreements
   between them instead of picking one. The agent is barred from writing status, rate,
   or carrier changes back into Full Circle.
4. **Fixed update format.** Customers get the same short layout every time: reference,
   lanes, status, location, ETA with time zone, next touch.
5. **Protects margin and carrier relationships.** Explicit rule that customer messages
   never mention rates, margin, or a carrier's internal problem.
6. **Audit log.** Every update sent is logged so a rep can see what a customer was told.
7. **Effort raised from low to medium.** Reconciling three sources per shipment is where
   low effort cuts corners.

## Connections needed before either version can run

`mcp_servers` is empty in both files. The agent has nothing attached yet. This is the
plan for wiring it up, in order of least effort first.

| Source | How the agent reads it | What is needed from Sterling |
|---|---|---|
| **Full Circle TMS** | Preferred: Full Circle's API or a scheduled export of the active load board. Fallback: a read-only Full Circle login used through a browser connector. | Ask Full Circle support whether API access is on the plan. If not, create a read-only user for the agent. |
| **Outlook (Microsoft 365)** | Microsoft 365 connector on the mailbox the updates send from. Read inbound carrier email, create drafts, send approved updates. | The mailbox address. A shared SBS mailbox (for example tracking@ or ops@) is recommended over a personal inbox so replies land where the team can see them. The Microsoft 365 admin grants the connector access to that one mailbox. |
| **Carrier tracking** | Browser connector opening the tracking link stored on each Full Circle load, plus any load-tracking service (Macropoint, Trucker Tools, FourKites) Sterling already pays for. | Confirm which tracking service, if any, is in use so the agent reads it directly instead of each carrier's site. |

Retired: Aljex. Not a source. Any Aljex load number in an old email is looked up in
Full Circle instead.

Open questions for the owner:

1. Which Outlook mailbox sends customer updates?
2. Is there a load-tracking service already in place, or is tracking carrier by carrier?
3. Does Full Circle expose an API or export on Sterling's plan?
