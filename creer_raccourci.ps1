Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pngPath   = Join-Path $scriptDir "frontend\images\logo-allure-blanc.png"
$icoPath   = Join-Path $scriptDir "logo-allure.ico"

Write-Host "  Lecture du logo PNG..."
$png = [System.Drawing.Image]::FromFile($pngPath)

# --- Image 256x256 ---
$bmp256 = New-Object System.Drawing.Bitmap(256, 256)
$g256   = [System.Drawing.Graphics]::FromImage($bmp256)
$g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g256.DrawImage($png, 0, 0, 256, 256)
$g256.Dispose()

# --- Image 32x32 ---
$bmp32 = New-Object System.Drawing.Bitmap(32, 32)
$g32   = [System.Drawing.Graphics]::FromImage($bmp32)
$g32.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g32.DrawImage($png, 0, 0, 32, 32)
$g32.Dispose()
$png.Dispose()

# --- Sauvegarder en PNG dans des MemoryStream ---
$ms32  = New-Object System.IO.MemoryStream
$ms256 = New-Object System.IO.MemoryStream
$bmp32.Save($ms32,   [System.Drawing.Imaging.ImageFormat]::Png)
$bmp256.Save($ms256, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes32  = $ms32.ToArray()
$bytes256 = $ms256.ToArray()
$ms32.Dispose(); $ms256.Dispose()
$bmp32.Dispose(); $bmp256.Dispose()

# --- Construire le fichier .ico manuellement ---
Write-Host "  Construction du fichier ICO..."
$count      = 2
$headerSize = 6 + $count * 16
$offset1    = $headerSize
$offset2    = $headerSize + $bytes32.Length

$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICO header
$bw.Write([uint16]0)       # reserved
$bw.Write([uint16]1)       # type = 1 (icon)
$bw.Write([uint16]$count)

# Entry 1 : 32x32
$bw.Write([byte]32); $bw.Write([byte]32)
$bw.Write([byte]0);  $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$bytes32.Length)
$bw.Write([uint32]$offset1)

# Entry 2 : 256x256
$bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$bytes256.Length)
$bw.Write([uint32]$offset2)

# Donnees images
$bw.Write($bytes32)
$bw.Write($bytes256)
$bw.Close(); $fs.Close()
Write-Host "  [OK] ICO cree : $icoPath"

# --- Creer le raccourci sur le Bureau ---
Write-Host "  Creation du raccourci..."
$desktopPath  = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "Allure+.lnk"
$targetPath   = Join-Path $scriptDir "start.bat"

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath       = $targetPath
$shortcut.WorkingDirectory = $scriptDir
$shortcut.IconLocation     = "$icoPath,0"
$shortcut.Description      = "Lancer Allure+"
$shortcut.WindowStyle      = 1
$shortcut.Save()

Write-Host "  [OK] Raccourci cree : $shortcutPath"
Write-Host ""
Write-Host "  Termine ! Le raccourci 'Allure+' est sur votre Bureau."
