# Agents

Agent definitions for Sterling Brokerage Services (SBS) tooling. The canonical design
document is the **SBS Claude Agents Build Kit** (a Claude doc); this folder holds the
paste-ready files.

| Path | What it is |
|---|---|
| `shipment-tracking-updater.yaml` | The Shipment Tracking Updater as first drafted: a hosted agent with connectors. Kept for the record. Superseded. |
| `shipment-tracking/` | **Agent 3: Shipment Tracking Updater**, rebuilt in the Build Kit pattern: Power Automate flow, one HTTP call to Claude, SharePoint log, Outlook send on approval. |

## Why the first draft was replaced

Sterling's tenant blocks Outlook and SharePoint from outside tools, so a hosted agent with
MCP connectors cannot reach the mailbox or the TMS. Agents 1 and 2 already solve this:
Power Automate reads the data and does every write, Claude only reads and answers over
one HTTP step. Agent 3 follows the same shape, so it is a third copy of a pattern that is
already live, not a new platform.

Full Circle TMS is the only system of record. Aljex is retired. Customer email goes
through the SBS Outlook mailbox.
