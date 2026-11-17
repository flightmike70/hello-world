#!/usr/bin/env python3
"""Build Power Automate import packages for Agent 3: Shipment Tracking Updater.

Run:  python3 agents/shipment-tracking/build_package.py
Writes agents/shipment-tracking/dist/*.zip plus the raw definition JSON for review.
No credentials are embedded. Placeholders are pasted in by Mick after import, the same
way the Check Call and Contact Sync flows were done.
"""
import json, os, uuid, zipfile, datetime, pathlib

HERE = pathlib.Path(__file__).parent
DIST = HERE / "dist"
SITE = "https://appriver3651010049.sharepoint.com/sites/SterlingBrokerageServices"
LIST = "Shipment Status Log"
FC = "https://gateway.api.fullcircletms.com"
MAILBOX = "michaelt@stibrokerage.com"
RATES = "RatesMBX@stibrokerage.com"
PROMPT = (HERE / "TrackingSystemPrompt.txt").read_text()
SCHEMA = json.loads((HERE / "shipment_status_schema.json").read_text())
SP_ICON = "https://connectoricons-prod.azureedge.net/releases/v1.0.1834/1.0.1834.5089/sharepointonline/icon.png"
O365_ICON = "https://connectoricons-prod.azureedge.net/releases/v1.0.1834/1.0.1834.5089/office365/icon.png"

def sp(op, params, run_after=None, **extra):
    a = {"runAfter": run_after or {}, "type": "OpenApiConnection",
         "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
                             "connectionName": "shared_sharepointonline", "operationId": op},
                    "parameters": {"dataset": SITE, **params},
                    "authentication": "@parameters('$authentication')"}}
    a.update(extra); return a

def o365(op, params, run_after=None, **extra):
    a = {"runAfter": run_after or {}, "type": "OpenApiConnection",
         "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_office365",
                             "connectionName": "shared_office365", "operationId": op},
                    "parameters": params, "authentication": "@parameters('$authentication')"}}
    a.update(extra); return a

def http(method, uri, run_after=None, headers=None, body=None, retry=None, secure=("inputs",)):
    inp = {"method": method, "uri": uri, "headers": headers or {}}
    if body is not None: inp["body"] = body
    inp["retryPolicy"] = retry or {"type": "exponential", "count": 4, "interval": "PT20S",
                                   "minimumInterval": "PT20S", "maximumInterval": "PT3M"}
    a = {"runAfter": run_after or {}, "type": "Http", "inputs": inp}
    if secure: a["runtimeConfiguration"] = {"secureData": {"properties": list(secure)}}
    return a

def after(*names, status=("Succeeded",)):
    return {n: list(status) for n in names}

def var(name, typ, value, run_after=None):
    return {"runAfter": run_after or {}, "type": "InitializeVariable",
            "inputs": {"variables": [{"name": name, "type": typ, "value": value}]}}

BEARER = {"Authorization": "Bearer @{body('Get_FC_token')?['access_token']}",
          "Content-Type": "application/json", "Accept": "application/json"}
FC_TOKEN = http("POST", f"{FC}/auth/token",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                body={"clientID": "PASTE-FULL-CIRCLE-CLIENT-ID", "clientSecret": "PASTE-FULL-CIRCLE-CLIENT-SECRET"},
                retry={"type": "fixed", "count": 3, "interval": "PT20S"}, secure=("inputs", "outputs"))

def definition(triggers, actions):
    return {"$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
            "contentVersion": "1.0.0.0",
            "parameters": {"$connections": {"defaultValue": {}, "type": "Object"},
                           "$authentication": {"defaultValue": {}, "type": "SecureObject"}},
            "triggers": triggers, "actions": actions, "outputs": {}}

# ---------------------------------------------------------------- Flow 0: provision the list
FIELDS = [  # (internal name, FieldTypeKind, extra)   2 Text, 3 Note, 4 DateTime, 6 Choice, 20 User
    ("Customer", 2, {}), ("CustomerRef", 2, {}), ("Rep", 2, {}),
    ("StatusClass", 6, {"Choices": ["ON_TIME", "AT_RISK", "DELAYED", "PROBLEM", "UNKNOWN"]}),
    ("Location", 2, {}), ("ETA", 4, {}),
    ("ETASource", 6, {"Choices": ["full_circle", "carrier_email", "none"]}),
    ("Evidence", 3, {}), ("Discrepancy", 3, {}),
    ("Confidence", 6, {"Choices": ["high", "medium", "low"]}),
    ("Reason", 3, {}), ("Recipient", 2, {}), ("DraftSubject", 2, {}), ("DraftBody", 3, {}),
    ("SendState", 6, {"Choices": ["Draft", "Approved", "Sent", "Held", "Logged"], "DefaultValue": "Draft"}),
    ("SentAt", 4, {}), ("SentBy", 20, {}), ("RunId", 2, {}),
]
def field_body(name, kind, extra):
    if kind == 6:
        b = {"__metadata": {"type": "SP.FieldChoice"}, "FieldTypeKind": 6, "Title": name,
             "Choices": {"results": extra["Choices"]}, "EditFormat": 0}
        if "DefaultValue" in extra: b["DefaultValue"] = extra["DefaultValue"]
        return b
    if kind == 20:
        return {"__metadata": {"type": "SP.FieldUser"}, "FieldTypeKind": 20, "Title": name, "SelectionMode": 0}
    return {"__metadata": {"type": "SP.Field"}, "FieldTypeKind": kind, "Title": name}

VERBOSE = {"accept": "application/json;odata=verbose", "content-type": "application/json;odata=verbose"}
def sp_rest(name, method, uri, body, run_after):
    return sp("HttpRequest", {"parameters/method": method, "parameters/uri": uri,
                              "parameters/headers": VERBOSE,
                              "parameters/body": json.dumps(body) if isinstance(body, dict) else body},
              run_after=run_after)

prov_actions = {
    "Create_list": sp_rest("Create_list", "POST", "_api/web/lists",
        {"__metadata": {"type": "SP.List"}, "BaseTemplate": 100, "Title": LIST,
         "Description": "Agent 3 Shipment Tracking Updater: one row per changed load, the audit log of every customer update. Title = Full Circle order number."}, {}),
}
prev = "Create_list"
for name, kind, extra in FIELDS:
    an = f"Add_{name}"
    prov_actions[an] = sp_rest(an, "POST", f"_api/web/lists/getbytitle('{LIST}')/fields", field_body(name, kind, extra), after(prev))
    prev = an
    vn = f"View_{name}"
    prov_actions[vn] = sp_rest(vn, "POST", f"_api/web/lists/getbytitle('{LIST}')/views/getbytitle('All Items')/viewfields/addviewfield('{name}')", "", after(prev))
    prev = vn
prov_actions["Rename_Title_column"] = sp_rest("Rename_Title_column", "POST", f"_api/web/lists/getbytitle('{LIST}')/fields/getbytitle('Title')",
    {"__metadata": {"type": "SP.Field"}, "Title": "OrderNumber"}, after(prev))
prov_actions["Rename_Title_column"]["inputs"]["parameters"]["parameters/headers"] = {**VERBOSE, "X-HTTP-Method": "MERGE", "IF-MATCH": "*"}
prov_actions["Create_Needs_Me_view"] = sp_rest("Create_Needs_Me_view", "POST", f"_api/web/lists/getbytitle('{LIST}')/views",
    {"__metadata": {"type": "SP.View"}, "Title": "Needs Me", "PersonalView": False, "RowLimit": 100,
     "ViewQuery": "<Where><Eq><FieldRef Name='SendState'/><Value Type='Choice'>Draft</Value></Eq></Where><OrderBy><FieldRef Name='StatusClass'/><FieldRef Name='Created' Ascending='FALSE'/></OrderBy>"},
    after("Rename_Title_column"))
prov_actions["Create_Sent_today_view"] = sp_rest("Create_Sent_today_view", "POST", f"_api/web/lists/getbytitle('{LIST}')/views",
    {"__metadata": {"type": "SP.View"}, "Title": "Sent today", "PersonalView": False, "RowLimit": 200,
     "ViewQuery": "<Where><And><Eq><FieldRef Name='SendState'/><Value Type='Choice'>Sent</Value></Eq><Geq><FieldRef Name='SentAt'/><Value Type='DateTime'><Today/></Value></Geq></And></Where><OrderBy><FieldRef Name='SentAt' Ascending='FALSE'/></OrderBy>"},
    after("Create_Needs_Me_view"))
for v in ("Needs Me", "Sent today"):
    prev = "Create_Sent_today_view" if v == "Needs Me" else f"NeedsMe_fields"
    an = "NeedsMe_fields" if v == "Needs Me" else "SentToday_fields"
    cols = ["Title", "Customer", "CustomerRef", "Rep", "StatusClass", "ETA", "Confidence", "Recipient", "DraftSubject", "SendState", "SentAt"]
    prov_actions[an] = {"runAfter": after(prev), "type": "Foreach", "foreach": cols,
        "actions": {f"Add_to_{an}": sp_rest("x", "POST", f"_api/web/lists/getbytitle('{LIST}')/views/getbytitle('{v}')/viewfields/addviewfield('@{{items('{an}')}}')", "", {})},
        "runtimeConfiguration": {"concurrency": {"repetitions": 1}}}
flow0 = definition({"manual": {"type": "Request", "kind": "Button", "inputs": {"schema": {"type": "object", "properties": {}}}}}, prov_actions)

# ---------------------------------------------------------------- Flow 1: tracking
NL = "decodeUriComponent('%0A')"
claude_body = {
    "model": "claude-haiku-5-5", "max_tokens": 1024,
    "system": "@{variables('TrackingSystemPrompt')}",
    "messages": [{"role": "user", "content": "@{outputs('Claude_user_message')}"}],
    "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}},
}
order_actions = {
    "Order_number": {"runAfter": {}, "type": "Compose", "inputs": "@string(items('For_each_order')?['orderNumber'])"},
    "Track": http("GET", f"{FC}/tracktrace/byordernumber?orderNumber=@{{outputs('Order_number')}}", after("Order_number"), headers=BEARER),
    "F999_match": {"runAfter": after("Order_number"), "type": "Query",
                   "inputs": {"from": "@coalesce(body('F999_contacts')?['records'], json('[]'))",
                              "where": "@equals(string(item()?['orderNumber']), outputs('Order_number'))"}},
    "F999_row": {"runAfter": after("F999_match"), "type": "Compose", "inputs": "@first(body('F999_match'))"},
    "Load_context": {"runAfter": after("Track", "F999_row"), "type": "Compose", "inputs": {
        "orderNumber": "@outputs('Order_number')",
        "customer": "@coalesce(outputs('F999_row')?['authorizationCustomerName'], outputs('F999_row')?['billToName'], '')",
        "customerReference": "@coalesce(outputs('F999_row')?['customerReferenceID'], outputs('F999_row')?['orderReferenceNumber'], '')",
        "rep": "@coalesce(outputs('F999_row')?['salesPerson1Name'], outputs('F999_row')?['bookedUser'], '')",
        "bookingContactEmail": "@coalesce(outputs('F999_row')?['authorizationCustomerContactEmail'], '')",
        "bookingContactName": "@trim(concat(coalesce(outputs('F999_row')?['authorizationCustomerContactFirstName'], ''), ' ', coalesce(outputs('F999_row')?['authorizationCustomerContactLastName'], '')))",
        "firstPickup": "@concat(coalesce(outputs('F999_row')?['firstPickupName'], ''), ', ', coalesce(outputs('F999_row')?['firstPickupCity'], ''), ', ', coalesce(outputs('F999_row')?['firstPickupStateCode'], ''))",
        "lastDelivery": "@concat(coalesce(outputs('F999_row')?['lastDeliveryName'], ''), ', ', coalesce(outputs('F999_row')?['lastDeliveryCity'], ''), ', ', coalesce(outputs('F999_row')?['lastDeliveryStateCode'], ''))",
        "manifestPosition": "@items('For_each_manifest')?['position']",
        "manifestNextStop": "@items('For_each_manifest')?['nextStop']",
        "manifestLastDelivery": "@items('For_each_manifest')?['lastDelivery']",
        "trackTrace": "@body('Track')"}},
    "Last_sent": sp("GetItems", {"table": LIST, "$filter": "Title eq '@{outputs('Order_number')}' and SendState eq 'Sent'", "$orderby": "SentAt desc", "$top": 1}, after("Order_number")),
    "Any_row": sp("GetItems", {"table": LIST, "$filter": "Title eq '@{outputs('Order_number')}'", "$top": 1}, after("Order_number")),
    "Mail_mine": o365("HttpRequest", {"Uri": "https://graph.microsoft.com/v1.0/me/messages?$search=\"@{outputs('Order_number')}\"&$top=10&$select=from,receivedDateTime,subject,bodyPreview", "Method": "GET", "ContentType": "application/json"}, after("Order_number")),
    "Mail_rates": o365("HttpRequest", {"Uri": f"https://graph.microsoft.com/v1.0/users/{RATES}/messages?$search=\"@{{outputs('Order_number')}}\"&$top=10&$select=from,receivedDateTime,subject,bodyPreview", "Method": "GET", "ContentType": "application/json"}, after("Order_number")),
    "Recent_mail": {"runAfter": {"Mail_mine": ["Succeeded", "Failed"], "Mail_rates": ["Succeeded", "Failed"]}, "type": "Query",
                    "inputs": {"from": "@union(coalesce(body('Mail_mine')?['value'], json('[]')), coalesce(body('Mail_rates')?['value'], json('[]')))",
                               "where": "@greaterOrEquals(item()?['receivedDateTime'], addHours(utcNow(), -48))"}},
    "Evidence_lines": {"runAfter": after("Recent_mail"), "type": "Select",
                       "inputs": {"from": "@body('Recent_mail')",
                                  "select": "@concat('--- From: ', item()?['from']?['emailAddress']?['address'], ' | Received: ', item()?['receivedDateTime'], ' | Subject: ', item()?['subject'], " + NL + ", item()?['bodyPreview'])"}},
    "Claude_user_message": {"runAfter": after("Load_context", "Last_sent", "Evidence_lines"), "type": "Compose",
        "inputs": "@concat('FULL CIRCLE ORDER, MANIFEST POSITION AND TRACK & TRACE (pulled ', utcNow(), ' UTC):', " + NL + ", string(outputs('Load_context')), " + NL + NL + ", 'LAST UPDATE SBS SENT THIS CUSTOMER FOR THIS LOAD (null if none):', " + NL + ", if(empty(body('Last_sent')?['value']), 'null', string(first(body('Last_sent')?['value']))), " + NL + NL + ", 'CARRIER EMAILS MENTIONING THIS LOAD, LAST 48 HOURS, OLDEST FIRST:', " + NL + ", if(empty(body('Evidence_lines')), 'None', join(body('Evidence_lines'), " + NL + NL + ")), " + NL + NL + ", 'Current time: ', convertFromUtc(utcNow(), 'Pacific Standard Time'), ' Pacific.')"},
    "Claude": http("POST", "https://api.anthropic.com/v1/messages", after("Claude_user_message"),
                   headers={"x-api-key": "PASTE-CLAUDE-API-KEY", "anthropic-version": "2023-06-01", "content-type": "application/json"},
                   body=claude_body, retry={"type": "fixed", "count": 3, "interval": "PT30S"}),
    "Parse_result": {"runAfter": after("Claude"), "type": "ParseJson",
                     "inputs": {"content": "@body('Claude')?['content']?[0]?['text']", "schema": SCHEMA}},
    "Should_log": {"runAfter": after("Parse_result"), "type": "If",
        "expression": {"or": [{"equals": ["@body('Parse_result')?['status_changed']", True]},
                              {"equals": ["@length(coalesce(body('Any_row')?['value'], json('[]')))", 0]}]},
        "actions": {
            "Log_row": sp("PostItem", {"table": LIST,
                "item/Title": "@outputs('Order_number')",
                "item/Customer": "@outputs('Load_context')?['customer']",
                "item/CustomerRef": "@coalesce(body('Parse_result')?['customer_reference'], outputs('Load_context')?['customerReference'])",
                "item/Rep": "@outputs('Load_context')?['rep']",
                "item/StatusClass/Value": "@body('Parse_result')?['status_class']",
                "item/Location": "@body('Parse_result')?['current_location']",
                "item/ETA": "@body('Parse_result')?['eta']",
                "item/ETASource/Value": "@body('Parse_result')?['eta_source']",
                "item/Evidence": "@body('Parse_result')?['evidence']",
                "item/Discrepancy": "@body('Parse_result')?['discrepancy']",
                "item/Confidence/Value": "@body('Parse_result')?['confidence']",
                "item/Reason": "@body('Parse_result')?['reason']",
                "item/Recipient": "@outputs('Load_context')?['bookingContactEmail']",
                "item/DraftSubject": "@body('Parse_result')?['customer_update']?['subject']",
                "item/DraftBody": "@body('Parse_result')?['customer_update']?['body']",
                "item/SendState/Value": "@if(equals(body('Parse_result')?['customer_update'], null), 'Logged', 'Draft')",
                "item/RunId": "@workflow()?['run']?['name']"}),
            "If_draft": {"runAfter": after("Log_row"), "type": "If",
                "expression": {"not": {"equals": ["@body('Parse_result')?['customer_update']", None]}},
                "actions": {
                    "Count_draft": {"runAfter": {}, "type": "IncrementVariable", "inputs": {"name": "DraftCount", "value": 1}},
                    "Digest_line": {"runAfter": after("Count_draft"), "type": "AppendToStringVariable",
                        "inputs": {"name": "DigestRows", "value": "<tr><td>@{body('Parse_result')?['status_class']}</td><td>@{outputs('Order_number')}</td><td>@{outputs('Load_context')?['customer']}</td><td>@{outputs('Load_context')?['customerReference']}</td><td>@{body('Parse_result')?['confidence']}</td><td>@{body('Parse_result')?['reason']}</td></tr>"}},
                    "If_urgent": {"runAfter": after("Digest_line"), "type": "If",
                        "expression": {"or": [{"equals": ["@body('Parse_result')?['status_class']", "DELAYED"]}, {"equals": ["@body('Parse_result')?['status_class']", "PROBLEM"]}]},
                        "actions": {"Count_urgent": {"runAfter": {}, "type": "IncrementVariable", "inputs": {"name": "UrgentCount", "value": 1}}}, "else": {"actions": {}}}},
                "else": {"actions": {}}}},
        "else": {"actions": {}}},
    "Pause": {"runAfter": {"Should_log": ["Succeeded", "Failed", "Skipped"]}, "type": "Wait", "inputs": {"interval": {"count": 2, "unit": "Second"}}},
}
flow1_actions = {
    "Init_prompt": var("TrackingSystemPrompt", "string", PROMPT),
    "Init_DraftCount": var("DraftCount", "integer", 0, after("Init_prompt")),
    "Init_UrgentCount": var("UrgentCount", "integer", 0, after("Init_DraftCount")),
    "Init_DigestRows": var("DigestRows", "string", "", after("Init_UrgentCount")),
    "Get_FC_token": {**FC_TOKEN, "runAfter": after("Init_DigestRows")},
    "Active_manifests": http("GET", f"{FC}/dispatch/manifests/active", after("Get_FC_token"), headers=BEARER),
    "F999_contacts": http("POST", f"{FC}/reports/f999", after("Get_FC_token"), headers=BEARER,
                          body={"startDate": "@{addDays(utcNow(), -31)}", "endDate": "@{utcNow()}", "includeManifests": False},
                          retry={"type": "exponential", "count": 6, "interval": "PT30S", "minimumInterval": "PT30S", "maximumInterval": "PT5M"}),
    "For_each_manifest": {"runAfter": after("Active_manifests", "F999_contacts"), "type": "Foreach",
        "foreach": "@coalesce(body('Active_manifests')?['manifests'], json('[]'))",
        "actions": {"For_each_order": {"runAfter": {}, "type": "Foreach", "foreach": "@coalesce(items('For_each_manifest')?['orders'], json('[]'))",
                                        "actions": order_actions, "runtimeConfiguration": {"concurrency": {"repetitions": 1}}}},
        "runtimeConfiguration": {"concurrency": {"repetitions": 1}}},
    "If_any_drafts": {"runAfter": after("For_each_manifest"), "type": "If",
        "expression": {"greater": ["@variables('DraftCount')", 0]},
        "actions": {"Digest_email": o365("SendEmailV2", {
            "emailMessage/To": MAILBOX,
            "emailMessage/Subject": "SBS tracking: @{variables('DraftCount')} customer updates waiting (@{variables('UrgentCount')} delayed or problem)",
            "emailMessage/Body": "<p>Drafts from this run, Problem and Delayed first. Approve them in the <a href=\"" + SITE + "/Lists/Shipment%20Status%20Log\">Shipment Status Log</a> Needs Me view; the Send Approved flow sends each one the minute its SendState turns Approved.</p><table border=\"1\" cellpadding=\"4\"><tr><th>Class</th><th>Order</th><th>Customer</th><th>Ref</th><th>Confidence</th><th>Why</th></tr>@{variables('DigestRows')}</table><p>Run @{workflow()?['run']?['name']}</p>",
            "emailMessage/Importance": "@if(greater(variables('UrgentCount'), 0), 'High', 'Normal')"})},
        "else": {"actions": {}}},
}
flow1 = definition({"Every_2_hours_weekdays": {"recurrence": {"frequency": "Week", "interval": 1, "timeZone": "Pacific Standard Time",
    "schedule": {"weekDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "hours": [6, 8, 10, 12, 14, 16, 18], "minutes": [0]}},
    "type": "Recurrence", "runtimeConfiguration": {"concurrency": {"runs": 1}}}}, flow1_actions)

# ---------------------------------------------------------------- Flow 2: send approved
flow2_actions = {
    "Send_to_customer": o365("SendEmailV2", {
        "emailMessage/To": "@triggerOutputs()?['body/Recipient']",
        "emailMessage/Subject": "@triggerOutputs()?['body/DraftSubject']",
        "emailMessage/Body": "<p>@{replace(coalesce(triggerOutputs()?['body/DraftBody'], ''), decodeUriComponent('%0A'), '<br>')}</p>",
        "emailMessage/Importance": "Normal"}),
    "Mark_sent": sp("PatchItem", {"table": LIST, "id": "@triggerOutputs()?['body/ID']",
        "item/Title": "@triggerOutputs()?['body/Title']",
        "item/SendState/Value": "Sent", "item/SentAt": "@utcNow()",
        "item/SentBy/Claims": "@triggerOutputs()?['body/Editor/Claims']"}, after("Send_to_customer")),
    "Mark_held": sp("PatchItem", {"table": LIST, "id": "@triggerOutputs()?['body/ID']",
        "item/Title": "@triggerOutputs()?['body/Title']", "item/SendState/Value": "Held",
        "item/Reason": "Send failed @{utcNow()}: @{coalesce(outputs('Send_to_customer')?['body']?['error']?['message'], 'see run history')}"},
        {"Send_to_customer": ["Failed", "TimedOut"]}),
}
flow2 = definition({"When_a_row_is_approved": {"recurrence": {"frequency": "Minute", "interval": 1}, "splitOn": "@triggerOutputs()?['body/value']",
    "type": "OpenApiConnection", "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline", "connectionName": "shared_sharepointonline", "operationId": "GetOnUpdatedItems"},
    "parameters": {"dataset": SITE, "table": LIST}, "authentication": "@parameters('$authentication')"},
    "conditions": [{"expression": "@and(equals(triggerOutputs()?['body/SendState/Value'], 'Approved'), not(empty(triggerOutputs()?['body/Recipient'])))"}]}}, flow2_actions)

# ---------------------------------------------------------------- packaging
APIS = {"shared_sharepointonline": ("SharePoint", SP_ICON), "shared_office365": ("Office 365 Outlook", O365_ICON)}
def package(display, defn, apis, fname):
    flow_id = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    resources, deps, conn_refs = {}, [], {}
    for api in apis:
        api_res, conn_res = str(uuid.uuid4()), str(uuid.uuid4()); conn_name = f"shared-{api.split('_')[1][:12]}-{str(uuid.uuid4())}"
        label, icon = APIS[api]
        resources[api_res] = {"id": f"/providers/Microsoft.PowerApps/apis/{api}", "name": api, "type": "Microsoft.PowerApps/apis",
            "suggestedCreationType": "Existing", "creationType": "Existing", "details": {"displayName": label, "iconUri": icon},
            "configurableBy": "System", "hierarchy": "Child", "dependsOn": []}
        resources[conn_res] = {"id": f"/providers/Microsoft.PowerApps/apis/{api}/connections/{conn_name}", "name": conn_name,
            "type": "Microsoft.PowerApps/apis/connections", "suggestedCreationType": "Existing", "creationType": "Existing",
            "details": {"displayName": f"{label} ({MAILBOX})", "iconUri": icon, "connectionParametersSet": None},
            "configurableBy": "User", "hierarchy": "Child", "dependsOn": [api_res]}
        deps += [api_res, conn_res]
        conn_refs[api] = {"connectionName": conn_name, "source": "Embedded", "id": f"/providers/Microsoft.PowerApps/apis/{api}", "tier": "NotSpecified"}
    resources[str(uuid.uuid4())] = {"id": f"/providers/Microsoft.Flow/flows/{flow_id}", "name": flow_id, "type": "Microsoft.Flow/flows",
        "suggestedCreationType": "New", "creationType": "Existing, New", "details": {"displayName": display},
        "configurableBy": "User", "hierarchy": "Root", "dependsOn": deps}
    manifest = {"schema": "1.0", "details": {"displayName": display, "description": "Agent 3: Shipment Tracking Updater (SBS Claude Agents Build Kit)",
                "createdTime": now, "packageTelemetryId": str(uuid.uuid4()), "creator": "N/A", "sourceEnvironment": ""}, "resources": resources}
    flow_file = {"properties": {"connectionReferences": conn_refs, "definition": defn}, "schemaVersion": "1.0.0.0"}
    DIST.mkdir(exist_ok=True)
    (DIST / f"{fname}.definition.json").write_text(json.dumps(flow_file, indent=2))
    with zipfile.ZipFile(DIST / f"{fname}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        z.writestr("apisMap.json", "{}"); z.writestr("connectionsMap.json", "{}")
        z.writestr(f"Microsoft.Flow/flows/{flow_id}/definition.json", json.dumps(flow_file, indent=2))
    return fname

built = [package("SBS Shipment Status Log - provision once", flow0, ["shared_sharepointonline"], "0-provision-shipment-status-log"),
         package("SBS Shipment Tracking (Claude)", flow1, ["shared_sharepointonline", "shared_office365"], "1-shipment-tracking-claude"),
         package("SBS Shipment Tracking - Send Approved", flow2, ["shared_sharepointonline", "shared_office365"], "2-shipment-tracking-send-approved")]
print("built:", built)
