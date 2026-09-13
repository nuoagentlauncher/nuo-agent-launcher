# Generate app icon: gradient rounded background + N letter -> PNG + ICO
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$buildDir = 'C:\Users\Administrator\Desktop\nuo agent launcher\build'
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle(12, 12, 232, 232)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 60
$d = $r * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 59, 130, 246),
    [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
    45.0)
$g.FillPath($brush, $path)

$glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
$hlRect = New-Object System.Drawing.Rectangle(28, 20, 200, 96)
$hlPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$hr = 48
$hd = $hr * 2
$hlPath.AddArc($hlRect.X, $hlRect.Y, $hd, $hd, 180, 90)
$hlPath.AddArc($hlRect.Right - $hd, $hlRect.Y, $hd, $hd, 270, 90)
$hlPath.AddArc($hlRect.Right - $hd, $hlRect.Bottom, $hd, 10, 270, 90)
$hlPath.AddArc($hlRect.X, $hlRect.Bottom, $hd, 10, 180, 90)
$hlPath.CloseFigure()
$g.FillPath($glowBrush, $hlPath)

$font = New-Object System.Drawing.Font('Segoe UI Black', 120, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$fmt.LineAlignment = 'Center'
$textRect = New-Object System.Drawing.RectangleF(0, 6, 256, 250)
$g.DrawString('N', $font, [System.Drawing.Brushes]::White, $textRect, $fmt)

$g.Dispose()

$pngPath = Join-Path $buildDir 'icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("PNG saved: " + (Get-Item $pngPath).Length + " bytes")

# Pack PNG into ICO (256x256, PNG-compressed entry)
$fs = [System.IO.File]::OpenRead($pngPath)
$png = New-Object byte[] $fs.Length
[void]$fs.Read($png, 0, $fs.Length)
$fs.Close()
Write-Host ("PNG read back: " + $png.Length + " bytes")

$header = [byte[]]@(0,0, 1,0, 1,0, 0,0,0,0, 1,0, 32,0) + [System.BitConverter]::GetBytes([uint32]$png.Length) + [System.BitConverter]::GetBytes([uint32]22)
$icoData = New-Object byte[] ($header.Length + $png.Length)
[Array]::Copy($header, 0, $icoData, 0, $header.Length)
[Array]::Copy($png, 0, $icoData, $header.Length, $png.Length)
$icoPath = Join-Path $buildDir 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $icoData)

Write-Host ("icon.png: " + (Get-Item $pngPath).Length + " bytes")
Write-Host ("icon.ico: " + (Get-Item $icoPath).Length + " bytes")
