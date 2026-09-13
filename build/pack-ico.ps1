# Pack build/icon.png into a multi-size build/icon.ico
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$buildDir = 'C:\Users\Administrator\Desktop\nuo agent launcher\build'
$pngPath = Join-Path $buildDir 'icon.png'
$icoPath = Join-Path $buildDir 'icon.ico'

$bmp = New-Object System.Drawing.Bitmap($pngPath)

$sizes = @(256, 128, 64, 48, 32, 16)

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

# ICO header: reserved, type=1, count
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$imageData = @()
foreach ($s in $sizes) {
  $resized = New-Object System.Drawing.Bitmap($s, $s)
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = 'HighQualityBicubic'
  $rg.SmoothingMode = 'HighQuality'
  $rg.DrawImage($bmp, 0, 0, $s, $s)
  $rg.Dispose()

  $pngStream = New-Object System.IO.MemoryStream
  $resized.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $imageData += ,$pngStream.ToArray()
  $pngStream.Dispose()
  $resized.Dispose()
}

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$imageData[$i].Length)
  $bw.Write([UInt32]$offset)
  $offset += $imageData[$i].Length
}

foreach ($data in $imageData) {
  $bw.Write($data)
}

[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()
$bmp.Dispose()

Write-Host ("icon.ico: " + (Get-Item $icoPath).Length + " bytes, " + $sizes.Count + " sizes")
