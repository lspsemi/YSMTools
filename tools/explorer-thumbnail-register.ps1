# Registers the .ysm Explorer thumbnail provider for the current user, for
# development (docs/maintenance section 70). The installer does the same in
# src-tauri/windows/installer-hooks.nsh. Keep the CLSID in step with
# thumbnail-provider/src/lib.rs.
#
#   powershell -ExecutionPolicy Bypass -File tools/explorer-thumbnail-register.ps1 [-Dll <path>]
#   powershell -ExecutionPolicy Bypass -File tools/explorer-thumbnail-register.ps1 -Uninstall
#
# By default the release build is copied to thumbnail-provider/target/registered/
# first, so rebuilding is not blocked while Explorer holds the DLL. The handler
# runs inside Explorer (DisableProcessIsolation=1, see section 70), which keeps
# the registered copy loaded; a loaded DLL can still be renamed, so the old copy
# is moved aside (*.old, deleted on the next run once Explorer lets go).
param([string]$Dll = '', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$clsid = '{F6A5A6A3-58D9-4762-82C8-B325D784819C}'
$thumbnailHandler = '{e357fccd-a995-4576-b01f-234630154e96}'  # IThumbnailProvider
$classes = 'HKCU:\Software\Classes'

Add-Type -Namespace YsmThumb -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, System.IntPtr a, System.IntPtr b);'

if ($Uninstall) {
  Remove-Item -LiteralPath "$classes\.ysm\ShellEx\$thumbnailHandler" -Recurse -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$classes\CLSID\$clsid" -Recurse -ErrorAction SilentlyContinue
  [YsmThumb.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output 'Unregistered the .ysm thumbnail provider.'
  return
}

$root = Split-Path -Parent $PSScriptRoot
if (-not $Dll) {
  $built = Join-Path $root 'thumbnail-provider\target\release\ysm_thumbnail.dll'
  if (-not (Test-Path $built)) { throw "Build it first: cd thumbnail-provider; cargo build --release" }
  $folder = Join-Path $root 'thumbnail-provider\target\registered'
  New-Item -ItemType Directory -Force $folder | Out-Null
  $Dll = Join-Path $folder 'ysm_thumbnail.dll'
  Get-ChildItem -LiteralPath $folder -Filter '*.old' | ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch {} }
  if (Test-Path $Dll) { Rename-Item -LiteralPath $Dll -NewName "ysm_thumbnail.$([DateTime]::Now.Ticks).old" }
  Copy-Item -LiteralPath $built -Destination $Dll -Force
}
$Dll = (Resolve-Path -LiteralPath $Dll).Path

New-Item -Path "$classes\CLSID\$clsid\InprocServer32" -Force | Out-Null
Set-ItemProperty -LiteralPath "$classes\CLSID\$clsid" -Name '(default)' -Value 'YSM Thumbnail Provider'
Set-ItemProperty -LiteralPath "$classes\CLSID\$clsid\InprocServer32" -Name '(default)' -Value $Dll
Set-ItemProperty -LiteralPath "$classes\CLSID\$clsid\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'
# The isolated surrogate ignores HKCU classes; run in the shell's process.
New-ItemProperty -LiteralPath "$classes\CLSID\$clsid" -Name 'DisableProcessIsolation' -PropertyType DWord -Value 1 -Force | Out-Null
New-Item -Path "$classes\.ysm\ShellEx\$thumbnailHandler" -Force | Out-Null
Set-ItemProperty -LiteralPath "$classes\.ysm\ShellEx\$thumbnailHandler" -Name '(default)' -Value $clsid
[YsmThumb.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "Registered $Dll"
