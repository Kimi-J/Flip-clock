# FlipClockSaver 自动安装脚本
# 用法: 以管理员身份运行 powershell -ExecutionPolicy Bypass -File install.ps1
#
# 功能:
#   1. 检测管理员权限(必要时自动提权)
#   2. 检测/安装 WebView2 Runtime(全新电脑必备)
#   3. 复制 .scr 与 dist 资源到 %ProgramFiles%\FlipClockSaver
#   4. 注册到屏保选择列表(注册表 ScreenSaver)
#   5. 可选: 设为当前屏保并立即生效
#   6. 创建卸载脚本与卸载注册表项

param(
    [switch]$Uninstall,
    [switch]$SkipWebView2,
    [switch]$SetAsCurrent
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "FlipClockSaver 安装程序"
# 修复 PowerShell 控制台中文乱码(脚本为 UTF-8 编码)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

# ============================================================
# 工具函数
# ============================================================
function Write-Step  { param([string]$msg) Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-OK    { param([string]$msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$msg) Write-Host "    [X]  $msg" -ForegroundColor Red }
function Test-Admin  {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# 卸载流程
# ============================================================
if ($Uninstall) {
    Write-Step "卸载 FlipClockSaver"
    $installDir = Join-Path $env:ProgramFiles "FlipClockSaver"
    if (Test-Path $installDir) {
        Remove-Item $installDir -Recurse -Force
        Write-OK "已删除目录: $installDir"
    }
    # 清理注册表
    $regBase = "HKCU:\Control Panel\Desktop"
    $uninstKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FlipClockSaver"
    if (Test-Path $uninstKey) { Remove-Item $uninstKey -Recurse -Force }
    # 还原屏保设置(若是我们写过的)
    try {
        $cur = (Get-ItemProperty -Path $regBase -Name "SCRNSAVE.EXE" -ErrorAction Stop)."SCRNSAVE.EXE"
        if ($cur -like "*FlipClockSaver.scr*") {
            Remove-ItemProperty -Path $regBase -Name "SCRNSAVE.EXE" -ErrorAction SilentlyContinue
            Write-OK "已还原屏保设置"
        }
    } catch {}
    Write-Host "`n卸载完成。" -ForegroundColor Green
    pause
    exit 0
}

# ============================================================
# 1. 管理员权限(必要时自动提权)
# ============================================================
Write-Step "检查管理员权限"
if (-not (Test-Admin)) {
    Write-Warn "未以管理员身份运行,正在自动提权..."
    $cmd = "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($SetAsCurrent) { $cmd += " -SetAsCurrent" }
    if ($SkipWebView2) { $cmd += " -SkipWebView2" }
    Start-Process PowerShell -Verb RunAs -ArgumentList $cmd
    exit 0
}
Write-OK "已是管理员"

# ============================================================
# 2. 检测 WebView2 Runtime
# ============================================================
if (-not $SkipWebView2) {
    Write-Step "检测 WebView2 Runtime"
    $regPaths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    $installed = $false
    foreach ($p in $regPaths) {
        if (Test-Path $p) {
            $ver = (Get-ItemProperty $p -ErrorAction SilentlyContinue).pv
            if ($ver) { $installed = $true; Write-OK "已安装 WebView2 (版本 $ver)"; break }
        }
    }
    if (-not $installed) {
        Write-Warn "未检测到 WebView2 Runtime,正在下载并安装..."
        $bootUri = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
        $bootFile = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
        # 优先使用系统自带的 BITS 下载(更稳定)
        try {
            Start-BitsTransfer -Source $bootUri -Destination $bootFile -ErrorAction Stop
        } catch {
            Invoke-WebRequest -Uri $bootUri -OutFile $bootFile -UseBasicParsing
        }
        # 静默安装(机器级,需要管理员)
        $p = Start-Process -FilePath $bootFile `
            -ArgumentList "/silent","/install" -Wait -PassThru
        if ($p.ExitCode -ne 0) {
            Write-Err "WebView2 安装失败 (exit $($p.ExitCode))"
            Write-Host "    请手动安装: https://developer.microsoft.com/microsoft-edge/webview2/"
            pause; exit 1
        }
        Remove-Item $bootFile -Force -ErrorAction SilentlyContinue
        Write-OK "WebView2 Runtime 安装完成"
    }
} else {
    Write-Warn "已跳过 WebView2 检测"
}

# ============================================================
# 3. 准备安装目录
# ============================================================
Write-Step "准备安装目录"
$installDir = Join-Path $env:ProgramFiles "FlipClockSaver"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
Write-OK "目录: $installDir"

# ============================================================
# 4. 定位安装源(同目录的 .scr 与 dist 文件夹)
# ============================================================
Write-Step "查找安装源文件"
$scriptDir = Split-Path -Parent $PSCommandPath
$scrSource = Join-Path $scriptDir "FlipClockSaver.scr"
$distSource = Join-Path $scriptDir "dist"

# 兼容: 从 publish 子目录查找
if (-not (Test-Path $scrSource)) {
    $scrSource = Join-Path $scriptDir "publish\FlipClockSaver.scr"
    if (Test-Path $scrSource) {
        $distSource = Join-Path $scriptDir "publish\dist"
    }
}

if (-not (Test-Path $scrSource)) {
    Write-Err "未找到 FlipClockSaver.scr"
    Write-Host "    请确保 install.ps1 与 FlipClockSaver.scr / dist 文件夹在同一目录"
    Write-Host "    或与 publish 文件夹在同一目录"
    pause; exit 1
}
if (-not (Test-Path $distSource)) {
    Write-Err "未找到 dist 文件夹"
    pause; exit 1
}
Write-OK "源: $scrSource"
Write-OK "源: $distSource"

# ============================================================
# 5. 复制文件
# ============================================================
Write-Step "复制文件到安装目录"
$scrDest = Join-Path $installDir "FlipClockSaver.scr"
$distDest = Join-Path $installDir "dist"
Copy-Item $scrSource $scrDest -Force
if (Test-Path $distDest) { Remove-Item $distDest -Recurse -Force }
Copy-Item $distSource $distDest -Recurse -Force
Write-OK "FlipClockSaver.scr 已复制"
Write-OK "dist 资源已复制"

# ============================================================
# 6. 写入卸载脚本
# ============================================================
$uninstScript = Join-Path $installDir "uninstall.ps1"
@'
# FlipClockSaver 卸载脚本
$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:ProgramFiles "FlipClockSaver"
$regBase = "HKCU:\Control Panel\Desktop"
$uninstKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FlipClockSaver"
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
if (Test-Path $uninstKey) { Remove-Item $uninstKey -Recurse -Force }
try {
    $cur = (Get-ItemProperty -Path $regBase -Name "SCRNSAVE.EXE" -ErrorAction Stop)."SCRNSAVE.EXE"
    if ($cur -like "*FlipClockSaver.scr*") {
        Remove-ItemProperty -Path $regBase -Name "SCRNSAVE.EXE" -ErrorAction SilentlyContinue
    }
} catch {}
Write-Host "卸载完成。" -ForegroundColor Green
'@ | Set-Content -Path $uninstScript -Encoding UTF8

# ============================================================
# 7. 注册到"应用与功能"列表(便于用户找到卸载入口)
# ============================================================
Write-Step "写入卸载注册表项"
$uninstKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FlipClockSaver"
if (-not (Test-Path $uninstKey)) {
    New-Item -Path $uninstKey -Force | Out-Null
}
Set-ItemProperty -Path $uninstKey -Name "DisplayName"     -Value "FlipClockSaver 翻页时钟屏保"
Set-ItemProperty -Path $uninstKey -Name "DisplayVersion"  -Value "1.0.0.0"
Set-ItemProperty -Path $uninstKey -Name "Publisher"       -Value "FlipClockSaver"
Set-ItemProperty -Path $uninstKey -Name "InstallLocation" -Value $installDir
Set-ItemProperty -Path $uninstKey -Name "DisplayIcon"     -Value $scrDest
Set-ItemProperty -Path $uninstKey -Name "NoModify"        -Value 1 -Type DWord
Set-ItemProperty -Path $uninstKey -Name "NoRepair"        -Value 1 -Type DWord
Set-ItemProperty -Path $uninstKey -Name "UninstallString" -Value "powershell -ExecutionPolicy Bypass -File `"$uninstScript`""
Write-OK "已注册到控制面板"

# ============================================================
# 8. 设为当前屏保(可选)
# ============================================================
if ($SetAsCurrent) {
    Write-Step "设为当前屏保"
    $regBase = "HKCU:\Control Panel\Desktop"
    Set-ItemProperty -Path $regBase -Name "SCRNSAVE.EXE" -Value $scrDest -Type String
    # 通知系统刷新屏保设置
    $sig = '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);'
    Add-Type -MemberDefinition $sig -Name "SPI" -Namespace Win32 -ErrorAction SilentlyContinue
    [Win32.SPI]::SystemParametersInfo(15, 0, $scrDest, 3) | Out-Null
    Write-OK "已设为当前屏保"
}

# ============================================================
# 9. 完成提示
# ============================================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " FlipClockSaver 安装完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`n安装位置: $installDir" -ForegroundColor White
Write-Host "屏保文件: $scrDest" -ForegroundColor White
if (-not $SetAsCurrent) {
    Write-Host "`n下一步:" -ForegroundColor Yellow
    Write-Host "  方法1: 右键 FlipClockSaver.scr -> 安装"
    Write-Host "  方法2: 设置 -> 个性化 -> 锁屏界面 -> 屏幕保护程序"
    Write-Host "         选择 'FlipClockSaver' 即可"
    Write-Host "  方法3: 重跑本脚本并加 -SetAsCurrent 参数"
}
Write-Host "`n卸载方法:" -ForegroundColor Yellow
Write-Host "  设置 -> 应用 -> 找到 'FlipClockSaver 翻页时钟屏保' -> 卸载"
Write-Host "  或运行: $uninstScript"
Write-Host "`n测试模式:" -ForegroundColor Yellow
Write-Host "  屏保: FlipClockSaver.scr /s"
Write-Host "  配置: FlipClockSaver.scr /c"
Write-Host ""

$open = Read-Host "是否立即打开屏幕保护设置面板? (Y/N)"
if ($open -match "^[Yy]") {
    Start-Process "rundll32.exe" -ArgumentList "desk.cpl,dll,InstallScreenSaver $scrDest"
}
