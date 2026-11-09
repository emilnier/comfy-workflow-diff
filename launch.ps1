# Launch the local ComfyUI workflow diff in a Chrome/Edge app window.
$ErrorActionPreference = 'SilentlyContinue'
$html = Join-Path $PSScriptRoot 'index.html'
if (-not (Test-Path -LiteralPath $html)) {
    Write-Error 'index.html not found beside launch.ps1'
    exit 1
}
$uri = ([System.Uri]$html).AbsoluteUri

$candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)

foreach ($browser in $candidates) {
    if ($browser -and (Test-Path -LiteralPath $browser)) {
        Start-Process -FilePath $browser -ArgumentList @(
            "--app=$uri",
            '--window-size=1600,1000',
            '--no-first-run',
            '--disable-features=Translate'
        )
        exit 0
    }
}

# Last resort: open with the default browser.
Start-Process -FilePath $html
