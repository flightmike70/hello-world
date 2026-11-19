# Fix-PBI-Refresh.ps1
# Gets the "SBS Command Center" Power BI semantic model refreshing again from the cloud:
#  1. lists every data source and saves Anonymous sign-in on the public web ones (GitHub, weather, FMCSA)
#  2. turns the daily schedule back on (7, 9, 11 AM, 1, 3, 5 PM Pacific, failure emails on)
#  3. starts a refresh and waits for the result
# Run on Monster:  irm <raw url> | iex      Report: Desktop\PBI-refresh-report.txt

$ErrorActionPreference = 'Continue'
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PBI-refresh-report.txt'
"Power BI refresh fix  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')  on $env:COMPUTERNAME" | Out-File $report -Encoding utf8
function Log($t) { Write-Host $t; "$t" | Out-File $report -Append -Encoding utf8 }

$tok = az account get-access-token --resource https://analysis.windows.net/powerbi/api --query accessToken -o tsv 2>$null
if (-not $tok) { Log "Sign-in needed. A Microsoft window will open; use your Sterling work account."; az login --allow-no-subscriptions | Out-Null
    $tok = az account get-access-token --resource https://analysis.windows.net/powerbi/api --query accessToken -o tsv 2>$null }
if (-not $tok) { Log "Could not get a Power BI sign-in. Stopping."; return }
$h = @{ Authorization = "Bearer $tok" }
$base = 'https://api.powerbi.com/v1.0/myorg'

# find the dataset
$found = @()
try { $found += (Invoke-RestMethod "$base/datasets" -Headers $h).value | Where-Object name -like '*Command Center*' | ForEach-Object { [pscustomobject]@{ ds = $_; root = "$base/datasets/$($_.id)" } } } catch {}
try { foreach ($g in (Invoke-RestMethod "$base/groups" -Headers $h).value) {
    $found += (Invoke-RestMethod "$base/groups/$($g.id)/datasets" -Headers $h).value | Where-Object name -like '*Command Center*' | ForEach-Object { [pscustomobject]@{ ds = $_; root = "$base/groups/$($g.id)/datasets/$($_.id)" } } } } catch {}
if (-not $found) { Log "No semantic model named like 'Command Center' found. Stopping."; return }

foreach ($f in $found) {
    $root = $f.root
    Log "`n=== $($f.ds.name)  ($($f.ds.id)) ==="

    # 1. data sources
    Log "--- Data sources ---"
    try { $sources = (Invoke-RestMethod "$root/datasources" -Headers $h).value } catch { Log "Couldn't list data sources: $($_.Exception.Message)"; $sources = @() }
    foreach ($s in $sources) {
        $cd = $s.connectionDetails
        $where = (@($cd.url, $cd.path, $cd.server, $cd.database) | Where-Object { $_ }) -join ' | '
        Log "$($s.datasourceType): $where"
        $isWeb = $s.datasourceType -eq 'Web'
        $isSharePoint = $where -match 'sharepoint\.com'
        if ($isWeb -and -not $isSharePoint -and $s.gatewayId -and $s.datasourceId) {
            $cred = @{ credentialDetails = @{
                credentialType = 'Anonymous'; credentials = '{"credentialData":""}'
                encryptedConnection = 'Encrypted'; encryptionAlgorithm = 'None'; privacyLevel = 'Organizational' } } | ConvertTo-Json -Depth 5
            try { Invoke-RestMethod "$base/gateways/$($s.gatewayId)/datasources/$($s.datasourceId)" -Method Patch -Headers $h -Body $cred -ContentType 'application/json' | Out-Null
                  Log "    -> saved Anonymous sign-in" }
            catch { Log "    -> couldn't save sign-in: $($_.Exception.Message)" }
        } elseif ($isSharePoint) { Log "    -> SharePoint (uses your Microsoft sign-in; left as is)" }
    }

    # 2. schedule back on
    $sched = @{ value = @{ enabled = $true; days = @('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
        times = @('07:00','09:00','11:00','13:00','15:00','17:00'); localTimeZoneId = 'Pacific Standard Time'; notifyOption = 'MailOnFailure' } } | ConvertTo-Json -Depth 5
    try { Invoke-RestMethod "$root/refreshSchedule" -Method Patch -Headers $h -Body $sched -ContentType 'application/json' | Out-Null
          Log "`nSchedule ON: daily 7, 9, 11 AM, 1, 3, 5 PM Pacific, failure emails on." }
    catch { Log "`nCouldn't turn the schedule on: $($_.Exception.Message)" }

    # 3. refresh now and wait
    try { Invoke-RestMethod "$root/refreshes" -Method Post -Headers $h -Body '{"notifyOption":"MailOnFailure"}' -ContentType 'application/json' | Out-Null; Log "Refresh started. Waiting for it to finish (up to 20 minutes)..." }
    catch { Log "Couldn't start refresh (one may already be running): $($_.Exception.Message)" }
    $deadline = (Get-Date).AddMinutes(20)
    do { Start-Sleep 30; $last = (Invoke-RestMethod "$root/refreshes?`$top=1" -Headers $h).value[0]; Write-Host "  ...$($last.status)" }
    while ($last.status -eq 'Unknown' -and (Get-Date) -lt $deadline)
    Log "Latest refresh: $($last.startTime) -> $($last.endTime)  $($last.status)"
    if ($last.serviceExceptionJson) { Log "Error: $($last.serviceExceptionJson)" }
    if ($last.status -eq 'Completed') { Log "SUCCESS. Power BI is refreshing from the cloud again." }
}
Log "`nDone. Report saved to $report"
Write-Host "`nSend PBI-refresh-report.txt from your Desktop back to Joe." -ForegroundColor Green
