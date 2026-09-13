# Generate Minecraft grass block style icon: PNG + ICO
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$buildDir = 'C:\Users\Administrator\Desktop\nuo agent launcher\build'
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'None'
$g.InterpolationMode = 'NearestNeighbor'
$g.Clear([System.Drawing.Color]::Transparent)

# Minecraft grass block - isometric style (simplified front view)
# The icon is a square block with green top and dirt bottom

$margin = 20
$blockSize = $size - $margin * 2
$x0 = $margin
$y0 = $margin

# Colors (Minecraft palette)
$grassGreen = [System.Drawing.Color]::FromArgb(107, 167, 50)     # Grass green
$grassGreenDark = [System.Drawing.Color]::FromArgb(87, 142, 42)   # Darker grass
$grassGreenLight = [System.Drawing.Color]::FromArgb(134, 196, 67) # Lighter grass
$dirtBrown = [System.Drawing.Color]::FromArgb(134, 96, 67)         # Dirt brown
$dirtBrownDark = [System.Drawing.Color]::FromArgb(102, 72, 51)     # Dark dirt
$dirtBrownLight = [System.Drawing.Color]::FromArgb(160, 118, 84)   # Light dirt
$grassEdge = [System.Drawing.Color]::FromArgb(74, 122, 36)         # Grass edge dark

# Draw block with pixelated effect (16x16 grid scaled up)
$grid = 16
$cellPx = [Math]::Floor($blockSize / $grid)

# Grass block pattern (16x16):
# Row 0-3: grass top (green with variations)
# Row 4-5: grass+dirt transition
# Row 6-15: dirt (brown with variations)

# Define the block pattern
$pixels = @(
  @(0,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0),  # Row 0: grass top light
  @(0,1,0,0,0,0,1,0,0,0,1,0,0,1,0,0),  # Row 1
  @(0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1),  # Row 2
  @(1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0),  # Row 3
  @(2,2,0,2,2,2,0,2,0,2,2,0,2,0,2,2),  # Row 4: grass edge (dark green + some dirt)
  @(2,3,2,0,3,2,3,2,2,3,0,2,3,2,0,2),  # Row 5: transition
  @(3,3,3,4,3,3,4,3,3,3,3,4,3,4,3,3),  # Row 6: dirt
  @(3,4,3,3,3,4,3,3,4,3,3,3,4,3,3,4),  # Row 7
  @(3,3,4,3,3,3,3,4,3,3,4,3,3,3,3,3),  # Row 8
  @(4,3,3,3,4,3,3,3,3,4,3,3,3,3,4,3),  # Row 9
  @(3,3,3,4,3,3,3,3,4,3,3,3,4,3,3,3),  # Row 10
  @(3,3,4,3,3,4,3,3,3,3,4,3,3,3,3,4),  # Row 11
  @(3,4,3,3,3,3,4,3,3,3,3,3,3,4,3,3),  # Row 12
  @(3,3,3,3,4,3,3,3,3,4,3,3,3,3,3,3),  # Row 13
  @(4,3,3,4,3,3,3,3,4,3,3,3,4,3,3,3),  # Row 14
  @(3,3,3,3,3,3,4,3,3,3,3,4,3,3,3,3)   # Row 15
)

# Color map: 0=light grass, 1=grass, 2=grass edge, 3=dirt, 4=dark dirt
$colors = @(
  $grassGreenLight,  # 0
  $grassGreen,       # 1
  $grassEdge,         # 2
  $dirtBrown,         # 3
  $dirtBrownDark      # 4
)

# Draw the pixelated block
for ($row = 0; $row -lt $grid; $row++) {
  for ($col = 0; $col -lt $grid; $col++) {
    $colorIdx = $pixels[$row][$col]
    $brush = New-Object System.Drawing.SolidBrush($colors[$colorIdx])
    $px = $x0 + $col * $cellPx
    $py = $y0 + $row * $cellPx
    $g.FillRectangle($brush, $px, $py, $cellPx + 1, $cellPx + 1)
    $brush.Dispose()
  }
}

# Draw a subtle border around the block
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 60, 60), 2)
$g.DrawRectangle($borderPen, $x0, $y0, $blockSize, $blockSize)
$borderPen.Dispose()

# Round corners by drawing transparent mask at corners
$cornerSize = 24
$cornerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
# Top-left
$g.FillPie($cornerBrush, $x0 - 2, $y0 - 2, $cornerSize * 2, $cornerSize * 2, 0, 90)
# This won't work with transparent. Instead, create rounded path.

$g.Dispose()

# Save PNG
$pngPath = Join-Path $buildDir 'icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "PNG saved: $pngPath"

# Generate ICO with multiple sizes
$icoPath = Join-Path $buildDir 'icon.ico'
$sizes = @(256, 128, 64, 48, 32, 16)

# Create ICO file header
$header = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($header)

# ICO header (6 bytes)
$bw.Write([UInt16]0)      # Reserved
$bw.Write([UInt16]1)     # Type: 1 = ICO
$bw.Write([UInt16]$sizes.Count)  # Number of images

# Prepare image data
$imageData = @()
foreach ($s in $sizes) {
  $resized = New-Object System.Drawing.Bitmap($s, $s)
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = 'NearestNeighbor'
  $rg.SmoothingMode = 'None'
  $rg.DrawImage($bmp, 0, 0, $s, $s)
  $rg.Dispose()

  $pngStream = New-Object System.IO.MemoryStream
  $resized.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $imageData += ,$pngStream.ToArray()
  $resized.Dispose()
}

# Write directory entries (16 bytes each)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))  # Width
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))  # Height
  $bw.Write([byte]0)     # Color palette
  $bw.Write([byte]0)     # Reserved
  $bw.Write([UInt16]1)   # Color planes
  $bw.Write([UInt16]32)  # Bits per pixel
  $bw.Write([UInt32]$imageData[$i].Length)  # Size of image data
  $bw.Write([UInt32]$offset)  # Offset
  $offset += $imageData[$i].Length
}

# Write image data
foreach ($data in $imageData) {
  $bw.Write($data)
}

# Write to file
[System.IO.File]::WriteAllBytes($icoPath, $header.ToArray())
$bw.Dispose()
$header.Dispose()

Write-Host "ICO saved: $icoPath"
Write-Host "Done!"
