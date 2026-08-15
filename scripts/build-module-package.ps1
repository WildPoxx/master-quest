param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\\master-quest.zip')
)

$ErrorActionPreference = 'Stop'

$moduleRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$output = [System.IO.Path]::GetFullPath($OutputPath)
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("master-quest-package-" + [guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stage 'master-quest'
$included = @('module.json', 'README.md', 'LICENSE', 'data', 'scripts', 'src', 'styles', 'templates')

try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  foreach ($entry in $included) {
    $source = Join-Path $moduleRoot $entry
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Package source is missing: $entry"
    }
    Copy-Item -LiteralPath $source -Destination $packageRoot -Recurse -Force
  }

  $outputDirectory = Split-Path -Parent $output
  if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  }
  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Force
  }

  Compress-Archive -LiteralPath $packageRoot -DestinationPath $output -CompressionLevel Optimal
  Write-Output "MasterQuest package written to $output"
}
finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
}
