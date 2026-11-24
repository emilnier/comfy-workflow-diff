# Build with the .NET Framework compiler included in Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path $root 'work/build'
$outputs = Join-Path $root 'outputs'
[void][IO.Directory]::CreateDirectory($work)
[void][IO.Directory]::CreateDirectory($outputs)

$page = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
foreach ($asset in @('styles.css', 'core.js', 'app.js')) {
    $name = [regex]::Escape($asset)
    $content = [IO.File]::ReadAllText((Join-Path $root $asset))
    if ($asset.EndsWith('.css')) {
        $pattern = '<link rel="stylesheet" href="' + $name + '(?:\?[^"]*)?">'
        $element = "<style>`n$content`n</style>"
    } else {
        $pattern = '<script src="' + $name + '(?:\?[^"]*)?"></script>'
        $element = "<script>`n$content`n</script>"
    }
    $tags = [regex]::Matches($page, $pattern)
    if ($tags.Count -ne 1) { throw "Expected exactly one reference to $asset" }
    $page = $page.Replace($tags[0].Value, $element)
}
$html = Join-Path $work 'index.html'
[IO.File]::WriteAllText($html, $page, [Text.UTF8Encoding]::new($false))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
$binary = Join-Path $outputs 'ComfyWorkflowDiff.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /debug- /noconfig /r:System.dll /r:System.Windows.Forms.dll "/resource:$html,index.html" "/out:$binary" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "C# compiler exited with code $LASTEXITCODE" }
Get-FileHash -Algorithm SHA256 -LiteralPath $binary
