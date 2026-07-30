# FlipClockSaver 屏保构建脚本
# 用法: 在项目根目录运行 powershell -ExecutionPolicy Bypass -File host\build-screensaver.ps1
# 参数:
#   -Configuration     Debug/Release(默认 Release)
#   -SkipInnoSetup     跳过 Inno Setup 打包(若未安装)
#   -SkipFrontend      跳过前端构建(用于调试宿主)

param(
    [string]$Configuration = "Release",
    [switch]$SkipInnoSetup,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
# 修复 PowerShell 控制台中文乱码(脚本为 UTF-8 编码)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
$root = Split-Path -Parent $PSScriptRoot
# 兜底:某些 PowerShell 会话下 $PSScriptRoot 在子调用后可能丢失,显式重建
if ([string]::IsNullOrEmpty($root)) { $root = (Get-Location).Path }
$hostProject = Join-Path $PSScriptRoot "FlipClockSaver\FlipClockSaver.csproj"
$publishDir = Join-Path $root "publish"
$installerSrc = Join-Path $PSScriptRoot "installer"
$issFile = Join-Path $installerSrc "flipclocksaver.iss"

Write-Host "项目根目录: $root" -ForegroundColor Gray
Write-Host "宿主项目:   $hostProject" -ForegroundColor Gray
Write-Host "发布目录:   $publishDir" -ForegroundColor Gray

Write-Host "=== FlipClockSaver 屏保构建 ===" -ForegroundColor Cyan

# 1. 构建前端
if (-not $SkipFrontend) {
    Write-Host "`n[1/4] 构建前端..." -ForegroundColor Yellow
    Push-Location $root
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Pop-Location
} else {
    Write-Host "`n[1/4] 跳过前端构建" -ForegroundColor Yellow
}

# 2. 发布 C# 宿主(self-contained + single-file)
Write-Host "`n[2/4] 发布 C# 宿主程序(self-contained)..." -ForegroundColor Yellow
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
# .csproj 已配置 SelfContained + PublishSingleFile,这里无需重复传 --self-contained
dotnet publish $hostProject -c $Configuration -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "C# 发布失败" }

# 3. 复制 dist 到发布目录,重命名 exe 为 scr
Write-Host "`n[3/4] 整理输出..." -ForegroundColor Yellow

# 复制 dist 文件夹
# 重新计算 $root(dotnet 子进程可能影响脚本变量,这里显式重建避免空值)
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = (Get-Location).Path }
$distSource = Join-Path $root "dist"
$distDest = Join-Path $publishDir "dist"
if (-not (Test-Path $distSource)) { throw "前端构建产物不存在: $distSource (请去掉 -SkipFrontend 重新构建)" }
if (Test-Path $distDest) { Remove-Item $distDest -Recurse -Force }
Copy-Item -LiteralPath $distSource -Destination $distDest -Recurse -Force

# 重命名 exe 为 scr(屏保后缀,但本质仍是 PE 可执行文件)
$exePath = Join-Path $publishDir "FlipClockSaver.exe"
$scrPath = Join-Path $publishDir "FlipClockSaver.scr"
if (Test-Path $exePath) {
    Move-Item $exePath $scrPath -Force
    Write-Host "  已生成: $scrPath" -ForegroundColor Green
}

# 拷贝安装脚本到 publish 目录,使 publish 文件夹可作为独立安装包源
if (Test-Path $installerSrc) {
    $instDest = Join-Path $publishDir "installer"
    if (Test-Path $instDest) { Remove-Item $instDest -Recurse -Force }
    Copy-Item $installerSrc $instDest -Recurse
    Write-Host "  已复制安装脚本到: $instDest" -ForegroundColor Green
}

# 列出最终产物
Write-Host "`n  发布目录内容:" -ForegroundColor Gray
Get-ChildItem $publishDir -File | ForEach-Object {
    $size = if ($_.Length -gt 1MB) { "{0:N1} MB" -f ($_.Length / 1MB) }
            elseif ($_.Length -gt 1KB) { "{0:N1} KB" -f ($_.Length / 1KB) }
            else { "$($_.Length) B" }
    Write-Host ("    {0,-32} {1}" -f $_.Name, $size) -ForegroundColor Gray
}

# 4. 调用 Inno Setup 生成 .exe 安装包(可选)
if (-not $SkipInnoSetup) {
    Write-Host "`n[4/4] 生成 Inno Setup 安装包..." -ForegroundColor Yellow

    # 探测 ISCC.exe(常见安装路径 + PATH)
    $iscc = $null
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "ISCC.exe"
    )
    foreach ($c in $candidates) {
        try {
            $found = Get-Command $c -ErrorAction Stop
            $iscc = $found.Source
            break
        } catch {}
    }

    if ($iscc -and (Test-Path $issFile)) {
        Write-Host "  使用 ISCC: $iscc" -ForegroundColor Gray
        & $iscc /Q $issFile
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Inno Setup 编译失败,跳过" -ForegroundColor Yellow
        } else {
            $outSetup = Join-Path $publishDir "..\FlipClockSaver-Setup.exe"
            $outSetup = [System.IO.Path]::GetFullPath($outSetup)
            if (Test-Path $outSetup) {
                $sz = "{0:N1} MB" -f ((Get-Item $outSetup).Length / 1MB)
                Write-Host "  安装包已生成: $outSetup ($sz)" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "  未检测到 Inno Setup 6,跳过打包" -ForegroundColor Yellow
        Write-Host "  下载地址: https://jrsoftware.org/isdl.php" -ForegroundColor Gray
        Write-Host "  也可直接使用 publish\installer\install.ps1 进行安装" -ForegroundColor Gray
    }
} else {
    Write-Host "`n[4/4] 跳过 Inno Setup 打包" -ForegroundColor Yellow
}

# 完成总结
Write-Host "`n=== 构建完成 ===" -ForegroundColor Cyan
Write-Host "`n产物:" -ForegroundColor White
Write-Host "  - 屏保文件:    $publishDir\FlipClockSaver.scr"
Write-Host "  - 前端资源:    $publishDir\dist\"
Write-Host "  - 安装脚本:    $publishDir\installer\install.ps1"
Write-Host "`n安装方式:" -ForegroundColor White
Write-Host "  方式1(推荐): 双击运行 publish\installer\install.ps1(自动提权+装 WebView2+注册)"
Write-Host "  方式2:        右键 FlipClockSaver.scr -> 安装"
Write-Host "  方式3:        将整个 publish 文件夹拷到目标机后运行 install.ps1 -SetAsCurrent"
Write-Host "`n测试方法:" -ForegroundColor White
Write-Host "  屏保模式: FlipClockSaver.scr /s"
Write-Host "  配置模式: FlipClockSaver.scr /c"
