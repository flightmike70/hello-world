# Check-F999-CloudConverter.ps1  - quick health check of the cloud F999 converter. Report: Desktop\F999-cloud-check.txt
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'F999-cloud-check.txt'
"F999 cloud converter check  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File $report -Encoding utf8
function Log($t) { Write-Host $t; "$t" | Out-File $report -Append -Encoding utf8 }
$RG = 'sbs-f999'
$settingsFile = Join-Path $env:USERPROFILE 'SBS Command Center\Tools\Cloud F999 Converter\settings.json'
if (Test-Path $settingsFile) { $s = Get-Content $settingsFile -Raw | ConvertFrom-Json; Log "Settings: app=$($s.app) subscription=$($s.subscriptionId)"; if ($s.subscriptionId) { az account set --subscription $s.subscriptionId } } else { Log "No settings file - setup may not have finished." }
Log "Resources in ${RG}:"
az resource list -g $RG --query "[].{name:name,type:type}" -o tsv 2>&1 | ForEach-Object { Log "  $_" }
$conn = az resource show -g $RG -n sharepointonline --resource-type Microsoft.Web/connections --query "properties.statuses[0]" -o json 2>&1
Log "SharePoint connection: $conn"
$la = az resource show -g $RG -n sbs-f999-flow --resource-type Microsoft.Logic/workflows --query "properties.state" -o tsv 2>&1
Log "Logic App state: $la"
$sub = az account show --query id -o tsv
$tok = az account get-access-token --query accessToken -o tsv
try {
  $runs = (Invoke-RestMethod "https://management.azure.com/subscriptions/$sub/resourceGroups/$RG/providers/Microsoft.Logic/workflows/sbs-f999-flow/runs?api-version=2016-06-01&`$top=10" -Headers @{Authorization="Bearer $tok"}).value
  Log "Recent runs: $($runs.Count)"
  foreach ($r in $runs) { Log "  $($r.properties.startTime)  $($r.properties.status)  $($r.properties.error.message)" }
  $hist = (Invoke-RestMethod "https://management.azure.com/subscriptions/$sub/resourceGroups/$RG/providers/Microsoft.Logic/workflows/sbs-f999-flow/triggers/New_file/histories?api-version=2016-06-01&`$top=5" -Headers @{Authorization="Bearer $tok"}).value
  Log "Recent trigger checks:"
  foreach ($h in $hist) { Log "  $($h.properties.startTime)  $($h.properties.status)  fired=$($h.properties.fired)  $($h.properties.error.message)" }
} catch { Log "Couldn't read run history: $($_.Exception.Message)" }
Log "Done. Send F999-cloud-check.txt from your Desktop to Joe."
