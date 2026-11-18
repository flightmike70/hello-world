# Check-and-Fix-F999.ps1
# Finds out why the Full Circle F999 isn't reaching Power BI, fixes the common causes,
# re-runs the daily copy, and starts a Power BI refresh. Safe to run more than once.
# Writes a report to your Desktop: F999-check-report.txt  (send that file back to Joe)

$ErrorActionPreference = 'Continue'
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'F999-check-report.txt'
"F999 check  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')  on $env:COMPUTERNAME" | Out-File $report -Encoding utf8
function Log($t) { Write-Host $t; $t | Out-File $report -Append -Encoding utf8 }

# ---------- 1. The Windows task ----------
Log "`n=== 1. Windows task 'SBS F999 to xlsx' ==="
$task = Get-ScheduledTask | Where-Object { $_.TaskName -like '*F999*' } | Select-Object -First 1
if (-not $task) {
    Log "PROBLEM: no scheduled task with F999 in its name was found."
} else {
    $info = $task | Get-ScheduledTaskInfo
    Log "Name: $($task.TaskPath)$($task.TaskName)   State: $($task.State)"
    Log "Last run: $($info.LastRunTime)   Result code: $($info.LastTaskResult)  (0 = OK)"
    Log "Next run: $($info.NextRunTime)   Missed runs: $($info.NumberOfMissedRuns)"
    foreach ($a in $task.Actions) { Log "Runs: $($a.Execute) $($a.Arguments)   (in $($a.WorkingDirectory))" }
    foreach ($t in $task.Triggers) { Log "Trigger: $($t.StartBoundary)  enabled=$($t.Enabled)" }
    Log "Wake to run: $($task.Settings.WakeToRun)   Run only when logged on: $($task.Principal.LogonType)"
    if ($task.State -eq 'Disabled') { Log "PROBLEM: task is disabled. Turning it back on."; $task | Enable-ScheduledTask | Out-Null }

    # find the script the task runs and its newest log
    $argText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    $scriptPath = ([regex]::Matches($argText, '[A-Za-z]:\\[^"]+?\.(ps1|py|bat|cmd)') | Select-Object -First 1).Value
    if ($scriptPath -and (Test-Path $scriptPath)) {
        $dir = Split-Path $scriptPath
        Log "Script: $scriptPath  (changed $((Get-Item $scriptPath).LastWriteTime))"
        $logs = Get-ChildItem $dir -Recurse -Include *.log,*log*.txt -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 2
        foreach ($l in $logs) { Log "--- last 40 lines of $($l.FullName) ($($l.LastWriteTime)) ---"; Get-Content $l.FullName -Tail 40 | ForEach-Object { Log "  $_" } }
        Log "--- first 80 lines of the script ---"
        Get-Content $scriptPath -TotalCount 80 | ForEach-Object { Log "  $_" }
    } else { Log "Could not find the script file from the task action." }
}

# task history from the event log (last 7 days)
try {
    $ev = Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'; StartTime=(Get-Date).AddDays(-7)} -ErrorAction Stop |
          Where-Object { $_.Message -like '*F999*' } | Select-Object -First 25
    Log "--- task history, last 7 days ---"
    foreach ($e in $ev) { Log "  $($e.TimeCreated)  id $($e.Id)  $(($e.Message -split "`n")[0])" }
} catch { Log "(Task history log is off or unreadable.)" }

# ---------- 2. Azure sign-in the task depends on ----------
Log "`n=== 2. Azure sign-in (az login) ==="
$az = Get-Command az -ErrorAction SilentlyContinue
if (-not $az) { Log "PROBLEM: Azure CLI (az) not found on this PC." }
else {
    $tok = az account get-access-token --resource https://graph.microsoft.com --query expiresOn -o tsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "PROBLEM: az sign-in has expired. Opening the sign-in window now. Sign in with your Sterling work account."
        az login --allow-no-subscriptions | Out-Null
        $tok = az account get-access-token --resource https://graph.microsoft.com --query expiresOn -o tsv 2>&1
        if ($LASTEXITCODE -eq 0) { Log "Signed in again OK. Token good until $tok" } else { Log "Sign-in still failing: $tok" }
    } else { Log "OK. Signed in as $(az account show --query user.name -o tsv). Token good until $tok" }
}

# ---------- 3. Today's F999 email ----------
Log "`n=== 3. F999 email check (Outlook on this PC) ==="
try {
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace('MAPI')
    $since = (Get-Date).AddDays(-8).ToString('MM/dd/yyyy HH:mm')
    foreach ($store in $ns.Stores) {
        try {
            $inbox = $store.GetDefaultFolder(6)
            $hits = $inbox.Items.Restrict("[ReceivedTime] >= '$since'") | Where-Object { $_.Subject -like '*F999*' -or ($_.Attachments | Where-Object { $_.FileName -like '*F999*' }) }
            foreach ($m in ($hits | Sort-Object ReceivedTime -Descending)) { Log "  $($m.ReceivedTime)  $($m.Subject)  attachments: $(($m.Attachments | ForEach-Object FileName) -join ', ')" }
        } catch {}
    }
} catch { Log "(Couldn't read Outlook on this PC - skip.)" }

# ---------- 4. Re-run the copy now (backfills what the script picks up) ----------
if ($task) {
    Log "`n=== 4. Re-running the task now ==="
    Start-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName
    $deadline = (Get-Date).AddMinutes(10)
    do { Start-Sleep 10; $s = (Get-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName).State } while ($s -eq 'Running' -and (Get-Date) -lt $deadline)
    $info = Get-ScheduledTaskInfo -TaskPath $task.TaskPath -TaskName $task.TaskName
    Log "Finished. Result code: $($info.LastTaskResult)  (0 = OK)"
}

# ---------- 5. Power BI dataset: schedule, refresh history, start a refresh ----------
Log "`n=== 5. Power BI ==="
if ($az) {
    $pbi = az account get-access-token --resource https://analysis.windows.net/powerbi/api --query accessToken -o tsv 2>$null
    if ($pbi) {
        $h = @{ Authorization = "Bearer $pbi" }
        $base = 'https://api.powerbi.com/v1.0/myorg'
        $sets = @()
        try { $sets += (Invoke-RestMethod "$base/datasets" -Headers $h).value | ForEach-Object { $_ | Add-Member groupId $null -PassThru } } catch {}
        try { foreach ($g in (Invoke-RestMethod "$base/groups" -Headers $h).value) { $sets += (Invoke-RestMethod "$base/groups/$($g.id)/datasets" -Headers $h).value | ForEach-Object { $_ | Add-Member groupId $g.id -PassThru -Force } } } catch {}
        $sets = $sets | Where-Object { $_.name -like '*Command Center*' }
        foreach ($d in $sets) {
            $root = if ($d.groupId) { "$base/groups/$($d.groupId)/datasets/$($d.id)" } else { "$base/datasets/$($d.id)" }
            Log "Dataset: $($d.name)  ($($d.id))"
            try { $sch = Invoke-RestMethod "$root/refreshSchedule" -Headers $h; Log "  Scheduled refresh on: $($sch.enabled)  days: $($sch.days -join ',')  times: $($sch.times -join ',')  ($($sch.localTimeZoneId))" } catch { Log "  (couldn't read schedule)" }
            try {
                $hist = (Invoke-RestMethod "$root/refreshes?`$top=8" -Headers $h).value
                foreach ($r in $hist) { Log "  $($r.startTime)  $($r.refreshType)  $($r.status)  $(if ($r.serviceExceptionJson) { $r.serviceExceptionJson })" }
            } catch { Log "  (couldn't read refresh history)" }
            try { Invoke-RestMethod "$root/refreshes" -Method Post -Headers $h -Body '{"notifyOption":"MailOnFailure"}' -ContentType 'application/json' | Out-Null; Log "  Started a refresh now." } catch { Log "  Couldn't start refresh: $($_.Exception.Message)" }
        }
        if (-not $sets) { Log "No dataset named like 'Command Center' found." }
    } else { Log "Couldn't get a Power BI token from az." }
}

Log "`nDone. Report saved to $report"
Write-Host "`nSend the file F999-check-report.txt on your Desktop back to Joe." -ForegroundColor Green
