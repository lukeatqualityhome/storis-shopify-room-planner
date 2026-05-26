#requires -version 5.1
<#
.SYNOPSIS
  Full STORIS -> Shopify sync. Run weekly via Windows Task Scheduler.
.DESCRIPTION
  Refreshes both catalogs, rebuilds the fuzzy mapping, then writes metafields
  for HIGH-confidence matches. Each step's stdout/stderr is appended to a
  timestamped log under logs/.
#>
[CmdletBinding()]
param(
  [switch]$DryRun  # If set, skips the final --live write.
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "sync-$Stamp.log"

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $LogFile -Append | Write-Host
}

function Invoke-Step {
  param([string]$Label, [string[]]$Arguments)
  Write-Log "START $Label"
  # Native-command stderr piped via 2>&1 becomes ErrorRecord objects in the pipeline.
  # With $ErrorActionPreference=Stop at module scope, the first stderr line would
  # throw a terminating error and kill the wrapper. Scope-down to Continue here so
  # only the exit code drives success/failure for native commands.
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & "npx" tsx @Arguments 2>&1 | Tee-Object -FilePath $LogFile -Append
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevPref
  }
  if ($code -ne 0) {
    Write-Log "FAILED $Label (exit $code)"
    throw "$Label failed (exit $code) - see $LogFile"
  }
  Write-Log "OK    $Label"
}

Write-Log "weekly-sync starting (project=$ProjectRoot, dryRun=$DryRun)"

try {
  Invoke-Step "export-storis"  @("src/index.ts", "--export-storis")
  Invoke-Step "export-shopify" @("src/index.ts", "--export-shopify")
  Invoke-Step "fuzzy-match"    @("src/index.ts", "--fuzzy-match")
  if ($DryRun) {
    Invoke-Step "sync (dry)"   @("src/index.ts", "--from-csv")
  } else {
    Invoke-Step "sync (live)"  @("src/index.ts", "--from-csv", "--live")
  }
  Write-Log "weekly-sync OK"
} catch {
  Write-Log "weekly-sync ERROR: $($_.Exception.Message)"
  exit 1
}
