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
   system", which does not describe how SBS operates. The revision names the TMS, the
   carrier tracking link, and email, in that order, and requires the agent to report
   disagreements between them instead of picking one.
4. **Fixed update format.** Customers get the same short layout every time: reference,
   lanes, status, location, ETA with time zone, next touch.
5. **Protects margin and carrier relationships.** Explicit rule that customer messages
   never mention rates, margin, or a carrier's internal problem.
6. **Audit log.** Every update sent is logged so a rep can see what a customer was told.
7. **Effort raised from low to medium.** Reconciling three sources per shipment is where
   low effort cuts corners.

## What is still missing before either version can run

- `mcp_servers` is empty in both files. The agent has no connection to a mailbox, a TMS,
  or a browser for carrier tracking pages. It cannot do its job until those are attached.
- The TMS needs to be named. The agent needs to know which system holds the active loads
  and how to read them (API, export, or a browser login).
