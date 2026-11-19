# Fix-F999-CloudConverter.ps1 - points the Logic App at the converter's real web address, gives the
# converter a fresh key, and tests it. Report: Desktop\F999-cloud-fix.txt
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'F999-cloud-fix.txt'
"F999 cloud converter fix  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File $report -Encoding utf8
function Log($t) { Write-Host $t; "$t" | Out-File $report -Append -Encoding utf8 }
$RG = 'sbs-f999'
$s = Get-Content (Join-Path $env:USERPROFILE 'SBS Command Center\Tools\Cloud F999 Converter\settings.json') -Raw | ConvertFrom-Json
az account set --subscription $s.subscriptionId
$App = $s.app

# 1. real host name
$hostName = $null
foreach ($q in 'defaultHostName', 'properties.defaultHostName', 'hostNames[0]', 'enabledHostNames[0]') {
    if (-not $hostName) { $hostName = az functionapp show -n $App -g $RG --query $q -o tsv 2>$null }
}
if (-not $hostName) { $hostName = az resource show -g $RG -n $App --resource-type Microsoft.Web/sites --query "properties.defaultHostName" -o tsv 2>$null }
if (-not $hostName) { $hostName = "$App.azurewebsites.net" }
Log "Converter address: $hostName"

# 2. fresh key (the old one was printed in a report)
$key = az functionapp keys set -g $RG -n $App --key-type functionKeys --key-name default --query value -o tsv 2>$null
if (-not $key) { $key = az functionapp keys list -g $RG -n $App --query "functionKeys.default" -o tsv }
$FuncUrl = "https://$hostName/api/convert?code=$key"

# 3. test the converter with a tiny .xls
try {
    $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
    $wb = $xl.Workbooks.Add(); $wb.Sheets(1).Cells(1,1).Value2 = 'order'; $wb.Sheets(1).Cells(2,1).Value2 = 12345
    $tx = Join-Path $env:TEMP 'f999-selftest.xls'; Remove-Item $tx -ErrorAction SilentlyContinue
    $wb.SaveAs($tx, 56); $wb.Close($false); $xl.Quit()
    $res = Invoke-WebRequest -Uri $FuncUrl -Method Post -InFile $tx -ContentType 'application/vnd.ms-excel' -UseBasicParsing -TimeoutSec 180
    Log "Converter test: HTTP $($res.StatusCode)  output: $($res.Content.Trim() -replace "`n",' / ')"
} catch { Log "Converter test FAILED: $($_.Exception.Message)" }

# 4. update the Logic App's Convert step
$sub = $s.subscriptionId
$tok = az account get-access-token --query accessToken -o tsv
$h = @{ Authorization = "Bearer $tok" }
$wfUrl = "https://management.azure.com/subscriptions/$sub/resourceGroups/$RG/providers/Microsoft.Logic/workflows/sbs-f999-flow?api-version=2019-05-01"
$wf = Invoke-RestMethod $wfUrl -Headers $h
$wf.properties.definition.actions.Is_new_F999_xls.actions.Convert.inputs.uri = $FuncUrl
$body = @{ location = $wf.location; properties = @{ state = 'Enabled'; definition = $wf.properties.definition; parameters = $wf.properties.parameters } } | ConvertTo-Json -Depth 60
try { Invoke-RestMethod $wfUrl -Method Put -Headers $h -Body $body -ContentType 'application/json' | Out-Null; Log "Logic App updated with the converter address." }
catch { Log "Logic App update FAILED: $($_.Exception.Message)" }
$check = (Invoke-RestMethod $wfUrl -Headers $h).properties.definition.actions.Is_new_F999_xls.actions.Convert.inputs.uri
Log "Logic App now calls: $($check -replace 'code=.*','code=(hidden)')"
Log "Done. Send F999-cloud-fix.txt from your Desktop to Joe."
