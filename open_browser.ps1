param(
    [string]$BrowserPath,
    [string]$Url = "http://localhost:3001"
)

$maxWaitSeconds = 15
$elapsed = 0
$ready = $false

while ($elapsed -lt $maxWaitSeconds) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 300
    $elapsed += 0.3
}

if ($BrowserPath -and (Test-Path $BrowserPath)) {
    Start-Process -FilePath $BrowserPath -ArgumentList "--app=$Url"
} else {
    Start-Process $Url
}
