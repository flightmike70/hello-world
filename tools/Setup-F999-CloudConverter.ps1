# Setup-F999-CloudConverter.ps1
# Builds the cloud F999 converter so new Full Circle F999 .xls files become .csv in SharePoint
# without Monster being on:
#   - Azure Function "convert" (.xls in, .csv out)
#   - Logic App "sbs-f999-flow": every 15 min, new F999 .xls in the FC Daily Reports library -> convert -> save .csv beside it
# Safe to run again: it reuses what already exists.
# Run on Monster:  irm <raw url> | iex      Report: Desktop\F999-cloud-setup-report.txt

$ErrorActionPreference = 'Continue'
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'F999-cloud-setup-report.txt'
"F999 cloud converter setup  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')  on $env:COMPUTERNAME" | Out-File $report -Encoding utf8
function Log($t) { Write-Host $t; "$t" | Out-File $report -Append -Encoding utf8 }
function Fail($t) { Log "STOPPED: $t"; Write-Host "`nSend F999-cloud-setup-report.txt from your Desktop to Joe." -ForegroundColor Yellow }

$Site     = 'https://appriver3651010049.sharepoint.com/sites/SterlingBrokerageServices'
$Library  = 'FC Daily Reports'
$RG       = 'sbs-f999'
$Loc      = 'eastus'
$LogicApp = 'sbs-f999-flow'
$ConnName = 'sharepointonline'
$SaveDir  = Join-Path $env:USERPROFILE 'SBS Command Center\Tools\Cloud F999 Converter'
New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null
$SettingsFile = Join-Path $SaveDir 'settings.json'
$settings = if (Test-Path $SettingsFile) { Get-Content $SettingsFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }

# ---------- 0. Azure subscription ----------
Log "`n=== 0. Azure subscription ==="
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Fail "Azure CLI not installed on this PC."; return }
$subs = az account list --query "[?state=='Enabled']" -o json 2>$null | ConvertFrom-Json
if (-not $subs) {
    Log "No subscription visible. Opening sign-in so Azure can list subscriptions..."
    az login | Out-Null
    $subs = az account list --query "[?state=='Enabled']" -o json 2>$null | ConvertFrom-Json
}
if (-not $subs) { Fail "Your sign-in has no Azure subscription. One is needed to host the converter (pay-as-you-go, a few dollars a month)."; return }
foreach ($s in $subs) { Log "Found: $($s.name)  ($($s.id))  account: $($s.user.name)" }
$sub = if ($settings.subscriptionId) { $subs | Where-Object id -eq $settings.subscriptionId | Select-Object -First 1 } else { $null }
if (-not $sub) { $sub = $subs | Select-Object -First 1 }
az account set --subscription $sub.id
Log "Using: $($sub.name)"
foreach ($p in 'Microsoft.Web','Microsoft.Logic','Microsoft.Storage') { az provider register --namespace $p 2>$null | Out-Null }

# ---------- 1. Resource group, storage, function app ----------
Log "`n=== 1. Converter app ==="
az group create -n $RG -l $Loc -o none
if (-not $settings.app) {
    $rand = Get-Random -Minimum 10000 -Maximum 99999
    $settings | Add-Member -Force app "sbs-f999-convert-$rand"
    $settings | Add-Member -Force storage "sbsf999$rand"
}
$settings | Add-Member -Force subscriptionId $sub.id
$settings | ConvertTo-Json | Out-File $SettingsFile -Encoding utf8
$App = $settings.app; $St = $settings.storage

if (-not (az storage account show -n $St -g $RG --query name -o tsv 2>$null)) {
    az storage account create -n $St -g $RG -l $Loc --sku Standard_LRS --allow-blob-public-access false -o none
    Log "Storage $St created."
}
if (-not (az functionapp show -n $App -g $RG --query name -o tsv 2>$null)) {
    az functionapp create -g $RG -n $App --storage-account $St --flexconsumption-location $Loc --runtime python --runtime-version 3.11 -o none 2>$null
    if (-not (az functionapp show -n $App -g $RG --query name -o tsv 2>$null)) {
        Log "Flex plan not available here, using the standard consumption plan."
        az functionapp create -g $RG -n $App --storage-account $St --consumption-plan-location $Loc --os-type Linux --runtime python --runtime-version 3.11 --functions-version 4 -o none
    }
}
if (-not (az functionapp show -n $App -g $RG --query name -o tsv 2>$null)) { Fail "Could not create the function app $App."; return }
Log "Function app: $App"

# code
$build = Join-Path $env:TEMP 'f999-convert-build'
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $build | Out-Null
"azure-functions`nxlrd==2.0.1" | Out-File (Join-Path $build 'requirements.txt') -Encoding ascii
'{ "version": "2.0", "extensionBundle": { "id": "Microsoft.Azure.Functions.ExtensionBundle", "version": "[4.*, 5.0.0)" } }' | Out-File (Join-Path $build 'host.json') -Encoding ascii
@'
import csv
import io

import azure.functions as func
import xlrd

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


def xls_to_csv(data: bytes) -> str:
    book = xlrd.open_workbook(file_contents=data)
    sheet = book.sheet_by_index(0)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for r in range(sheet.nrows):
        row = []
        for c in range(sheet.ncols):
            cell = sheet.cell(r, c)
            if cell.ctype == xlrd.XL_CELL_DATE:
                dt = xlrd.xldate_as_datetime(cell.value, book.datemode)
                row.append(dt.strftime("%Y-%m-%d %H:%M:%S"))
            elif cell.ctype == xlrd.XL_CELL_NUMBER:
                v = cell.value
                row.append(str(int(v)) if v == int(v) else repr(v))
            elif cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                row.append("")
            else:
                row.append(str(cell.value))
        writer.writerow(row)
    return out.getvalue()


@app.route(route="convert", methods=["POST"])
def convert(req: func.HttpRequest) -> func.HttpResponse:
    data = req.get_body()
    if not data:
        return func.HttpResponse("No file received", status_code=400)
    try:
        text = xls_to_csv(data)
    except Exception as e:
        return func.HttpResponse(f"Could not read the F999 file: {e}", status_code=422)
    return func.HttpResponse(text.encode("utf-8"), mimetype="text/csv", status_code=200)
'@ | Out-File (Join-Path $build 'function_app.py') -Encoding ascii
$zip = Join-Path $env:TEMP 'f999-convert.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $build '*') -DestinationPath $zip
Log "Uploading converter code (takes a few minutes)..."
az functionapp deployment source config-zip -g $RG -n $App --src $zip --build-remote true -o none
$key = $null
for ($i = 0; $i -lt 12 -and -not $key; $i++) { $key = az functionapp keys list -g $RG -n $App --query "functionKeys.default" -o tsv 2>$null; if (-not $key) { Start-Sleep 10 } }
if (-not $key) { Fail "Converter deployed but its key isn't ready yet. Run the same line again in 5 minutes."; return }
$HostName = az resource show -g $RG -n $App --resource-type Microsoft.Web/sites --query "properties.defaultHostName" -o tsv 2>$null
if (-not $HostName) { $HostName = "$App.azurewebsites.net" }
$FuncUrl = "https://$HostName/api/convert?code=$key"
Log "Converter ready."

# quick self-test with a tiny .xls (optional, skipped if Excel isn't available)
try {
    $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
    $wb = $xl.Workbooks.Add(); $wb.Sheets(1).Cells(1,1).Value2 = 'order'; $wb.Sheets(1).Cells(2,1).Value2 = 12345
    $tx = Join-Path $env:TEMP 'f999-selftest.xls'; Remove-Item $tx -ErrorAction SilentlyContinue
    $wb.SaveAs($tx, 56); $wb.Close($false); $xl.Quit()
    $res = Invoke-WebRequest -Uri $FuncUrl -Method Post -InFile $tx -ContentType 'application/vnd.ms-excel' -UseBasicParsing -TimeoutSec 120
    Log "Self-test: HTTP $($res.StatusCode)  output: $($res.Content.Trim() -replace "`n",' / ')"
} catch { Log "Self-test skipped or failed: $($_.Exception.Message)" }

# ---------- 2. SharePoint connection + Logic App ----------
Log "`n=== 2. Folder watcher (Logic App) ==="
$subId = $sub.id
$siteEnc = "@{encodeURIComponent(encodeURIComponent('$Site'))}"
$template = @{
  '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#'
  contentVersion = '1.0.0.0'
  resources = @(
    @{ type = 'Microsoft.Web/connections'; apiVersion = '2016-06-01'; name = $ConnName; location = $Loc
       properties = @{ displayName = 'SharePoint (Sterling)'; api = @{ id = "/subscriptions/$subId/providers/Microsoft.Web/locations/$Loc/managedApis/sharepointonline" } } },
    @{ type = 'Microsoft.Logic/workflows'; apiVersion = '2019-05-01'; name = $LogicApp; location = $Loc
       dependsOn = @("[resourceId('Microsoft.Web/connections', '$ConnName')]")
       properties = @{
         state = 'Enabled'
         parameters = @{ '$connections' = @{ value = @{ sharepointonline = @{
             connectionId = "[resourceId('Microsoft.Web/connections', '$ConnName')]"
             connectionName = $ConnName
             id = "/subscriptions/$subId/providers/Microsoft.Web/locations/$Loc/managedApis/sharepointonline" } } } }
         definition = @{
           '$schema' = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
           contentVersion = '1.0.0.0'
           parameters = @{ '$connections' = @{ type = 'Object'; defaultValue = @{} } }
           triggers = @{ New_file = @{
               type = 'ApiConnection'; recurrence = @{ frequency = 'Minute'; interval = 15 }
               splitOn = "@triggerBody()?['value']"
               inputs = @{ host = @{ connection = @{ name = "@parameters('`$connections')['sharepointonline']['connectionId']" } }
                           method = 'get'
                           path = "/datasets/$siteEnc/tables/@{encodeURIComponent(encodeURIComponent('$Library'))}/onnewfileitems" } } }
           actions = @{
             Is_new_F999_xls = @{
               type = 'If'; runAfter = @{}
               expression = @{ and = @(
                 @{ endsWith = @("@toLower(triggerBody()?['{FilenameWithExtension}'])", '.xls') },
                 @{ contains = @("@toUpper(triggerBody()?['{FilenameWithExtension}'])", 'F999') } ) }
               actions = @{
                 Get_file_content = @{ type = 'ApiConnection'; runAfter = @{}
                   inputs = @{ host = @{ connection = @{ name = "@parameters('`$connections')['sharepointonline']['connectionId']" } }
                               method = 'get'
                               path = "/datasets/$siteEnc/files/@{encodeURIComponent(triggerBody()?['{Identifier}'])}/content"
                               queries = @{ inferContentType = $true } } }
                 Convert = @{ type = 'Http'; runAfter = @{ Get_file_content = @('Succeeded') }
                   inputs = @{ method = 'POST'; uri = $FuncUrl; body = "@body('Get_file_content')"
                               headers = @{ 'Content-Type' = 'application/vnd.ms-excel' } } }
                 Save_csv = @{ type = 'ApiConnection'; runAfter = @{ Convert = @('Succeeded') }
                   inputs = @{ host = @{ connection = @{ name = "@parameters('`$connections')['sharepointonline']['connectionId']" } }
                               method = 'post'
                               path = "/datasets/$siteEnc/files"
                               queries = @{ folderPath = "/$Library"; name = "@{triggerBody()?['{Name}']}.csv"; queryParametersSingleEncoded = $true }
                               body = "@body('Convert')" } }
               }
               else = @{ actions = @{} }
             }
           }
           outputs = @{}
         }
       } }
  )
}
$tplFile = Join-Path $env:TEMP 'f999-logicapp.json'
$template | ConvertTo-Json -Depth 50 | Out-File $tplFile -Encoding utf8
$dep = az deployment group create -g $RG --template-file $tplFile -o json 2>&1
if ($LASTEXITCODE -ne 0) { Log ($dep | Out-String); Fail "Couldn't create the Logic App."; return }
Log "Logic App $LogicApp and SharePoint connection created."

# ---------- 3. Approve the SharePoint sign-in ----------
$status = az resource show -g $RG -n $ConnName --resource-type Microsoft.Web/connections --query "properties.statuses[0].status" -o tsv 2>$null
Log "SharePoint connection status: $status"
if ($status -ne 'Connected') {
    $url = "https://portal.azure.com/#resource/subscriptions/$subId/resourceGroups/$RG/providers/Microsoft.Web/connections/$ConnName/edit"
    Log "`nONE CLICK NEEDED: a browser page is opening. Click 'Authorize', sign in with your Sterling account, then click 'Save'."
    Start-Process $url
    Read-Host "Press Enter here after you clicked Save"
    $status = az resource show -g $RG -n $ConnName --resource-type Microsoft.Web/connections --query "properties.statuses[0].status" -o tsv 2>$null
    Log "SharePoint connection status now: $status"
}

$settings | Add-Member -Force functionHost $HostName
$settings | ConvertTo-Json | Out-File $SettingsFile -Encoding utf8
Log "`nSettings saved in $SettingsFile"
if ($status -eq 'Connected') { Log "ALL SET. New F999 .xls files in '$Library' will get a .csv copy within 15 minutes, with or without Monster." }
Log "Done. Report saved to $report"
Write-Host "`nSend F999-cloud-setup-report.txt from your Desktop to Joe." -ForegroundColor Green
