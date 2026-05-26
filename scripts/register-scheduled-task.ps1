#requires -version 5.1
<#
.SYNOPSIS
  Registers the QHF Storis-Shopify weekly sync as a Windows Scheduled Task.
.DESCRIPTION
  Runs weekly-sync.ps1 every Sunday at 03:00 under the current user. Idempotent;
  re-registering replaces any existing task with the same name. Run once.
.PARAMETER TaskName
  Name of the scheduled task in Task Scheduler. Default: "QHF Storis-Shopify Weekly Sync".
.PARAMETER DayOfWeek
  Day to run on. Default: Sunday.
.PARAMETER Time
  24-hour HH:MM string. Default: "03:00".
.PARAMETER DryRun
  If set, the scheduled task runs the sync in dry-run mode (no metafield writes).
#>
[CmdletBinding()]
param(
  [string]$TaskName = "QHF Storis-Shopify Weekly Sync",
  [ValidateSet("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")]
  [string]$DayOfWeek = "Sunday",
  [string]$Time = "03:00",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SyncScript = Join-Path $ProjectRoot "scripts\weekly-sync.ps1"
if (-not (Test-Path $SyncScript)) { throw "Missing $SyncScript" }

$psArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$SyncScript`""
if ($DryRun) { $psArgs += " -DryRun" }
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $Time
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Register as current user, no elevation needed (sync only touches local files +
# HTTPS to api.storis.com / *.myshopify.com).
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed existing task '$TaskName'."
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description "Weekly refresh of STORIS dimensions into Shopify product metafields. See $ProjectRoot." | Out-Null

Write-Host "Registered '$TaskName' for $DayOfWeek at $Time. Logs land in $ProjectRoot\logs."
Write-Host "Trigger manually: Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "Inspect: Get-ScheduledTaskInfo -TaskName `"$TaskName`""
