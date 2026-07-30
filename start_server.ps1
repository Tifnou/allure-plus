$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = "node"
$serverJs = Join-Path $dir "server.js"
Start-Process -FilePath $node -ArgumentList "`"$serverJs`"" -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dir "server.log") -RedirectStandardError (Join-Path $dir "server_err.log")