; ============================================================
; FlipClockSaver Inno Setup 脚本
; 用法: ISCC.exe flipclocksaver.iss
; 输出: 项目根目录\FlipClockSaver-Setup.exe
;
; 注意:所有含花括号的 PowerShell 命令均放在 [Code] 段用
;       ShellExec 调用,因为 [Run]/[UninstallRun] 的参数
;       会被 Inno Setup 解析 {常量},而 Pascal 字符串不会。
; ============================================================

#define MyAppName          "FlipClockSaver"
#define MyAppDisplayName   "FlipClockSaver 翻页时钟屏保"
#define MyAppVersion       "1.0.0.0"
#define MyAppPublisher     "FlipClockSaver"
#define MyAppURL           "https://github.com/FlipClockSaver"
#define MyAppExeName       "FlipClockSaver.scr"

; 源文件路径(相对于本 .iss 所在的 installer 目录)
#define PublishDir         "..\..\publish"

[Setup]
AppId={{8F9C7B6A-1234-5678-9ABC-DEF012345678}
AppName={#MyAppDisplayName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppDisplayName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppDisplayName}
DisableProgramGroupPage=yes
OutputDir=..\..
OutputBaseFilename=FlipClockSaver-Setup
; 安装包图标(使用项目根目录的 icon.ico)
SetupIconFile=..\..\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppDisplayName}
Uninstallable=yes

[Languages]
; Inno Setup 6.7 默认不含简中文语言包,使用内置英文向导
; 如需中文向导,从 https://jrsoftware.org/files/istrans/ 下载 ChineseSimplified.isl
; 放入 Inno Setup 安装目录的 Languages\ 文件夹后取消下行注释
; Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式(&D)"; GroupDescription: "附加图标:"; Flags: unchecked
Name: "setcurrent";  Description: "设为当前屏保(立即生效)(&S)"; GroupDescription: "其他选项:"

[Files]
; 主屏保程序
Source: "{#PublishDir}\FlipClockSaver.scr"; DestDir: "{app}"; Flags: ignoreversion
; 前端资源(dist 文件夹整体打包)
Source: "{#PublishDir}\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
; 卸载脚本(随程序安装,便于手动卸载)
Source: "{#PublishDir}\installer\install.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; 立即打开屏保选择面板(用户可选,此命令无花括号,安全)
Filename: "rundll32.exe"; \
  Parameters: "desk.cpl,dll,InstallScreenSaver {app}\{#MyAppExeName}"; \
  Flags: nowait postinstall skipifsilent; Description: "立即打开屏幕保护设置面板"

[Icons]
Name: "{group}\{#MyAppDisplayName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "/c"
Name: "{group}\卸载 {#MyAppDisplayName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppDisplayName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "/c"; Tasks: desktopicon

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// ============================================================
// 常量(在 Pascal 中花括号是普通字符,不会被解析为 Inno Setup 常量)
// ============================================================
const
  // WebView2 Runtime 的注册表检测键(3 个可能位置)
  WV2_Key1 = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WV2_Key2 = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WV2_Key3 = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  // WebView2 官方引导程序下载地址
  WV2_BootUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

// ============================================================
// 检测 WebView2 Runtime 是否已安装
// ============================================================
function NeedWebView2(): Boolean;
var
  pv: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, WV2_Key1, 'pv', pv) then
    Result := False
  else if RegQueryStringValue(HKLM, WV2_Key2, 'pv', pv) then
    Result := False
  else if RegQueryStringValue(HKCU, WV2_Key3, 'pv', pv) then
    Result := False;
end;

// ============================================================
// 下载并静默安装 WebView2 Runtime
// (用 ShellExec 调 PowerShell 下载,命令中不含花括号)
// ============================================================
procedure InstallWebView2IfNeeded();
var
  ResultCode: Integer;
  TempFile: String;
  PsCmd: String;
begin
  if not NeedWebView2() then Exit;

  TempFile := ExpandConstant('{tmp}\wv2setup.exe');
  // PowerShell 下载命令:Start-BitsTransfer -Source 'URL' -Destination 'PATH'
  // 整条命令无花括号,避免 Inno Setup 常量解析
  PsCmd := '-ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-BitsTransfer -Source ''' + WV2_BootUrl + ''' -Destination ''' + TempFile + '''"';

  if ShellExec('open', 'powershell.exe', PsCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    if FileExists(TempFile) then begin
      ShellExec('open', TempFile, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      DeleteFile(TempFile);
    end else begin
      SuppressibleMsgBox('WebView2 Runtime 下载失败,屏保可能无法正常运行。' + #13#10 + '请手动安装: https://developer.microsoft.com/microsoft-edge/webview2/', mbError, MB_OK, IDOK);
    end;
  end;
end;

// ============================================================
// 设为当前屏保(写注册表 + 调用 SystemParametersInfo 立即生效)
// ============================================================
procedure SetAsCurrentScreensaver();
var
  ResultCode: Integer;
  ScrPath: String;
  PsCmd: String;
begin
  ScrPath := ExpandConstant('{app}\{#MyAppExeName}');
  // 1. 写注册表(REG_SZ)
  RegWriteStringValue(HKCU, 'Control Panel\Desktop', 'SCRNSAVE.EXE', ScrPath);
  // 2. 通知系统立即刷新(SPI_SETSCREENSAVE = 15, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3)
  //    用 PowerShell P/Invoke 调 user32!SystemParametersInfo
  PsCmd := '-ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -MemberDefinition ''[DllImport(\""user32.dll\"")] public static extern bool SystemParametersInfo(int a,int b,string c,int d);'' -Name S -Namespace W; [W.S]::SystemParametersInfo(15,0,''' + ScrPath + ''',3) | Out-Null"';
  ShellExec('open', 'powershell.exe', PsCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ============================================================
// 安装完成后回调:安装 WebView2 + 可选设为当前屏保
// ============================================================
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    InstallWebView2IfNeeded();
    if WizardIsTaskSelected('setcurrent') then
      SetAsCurrentScreensaver();
  end;
end;

// ============================================================
// 卸载时回调:若是当前屏保则还原
// ============================================================
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CurScr: String;
begin
  if CurUninstallStep = usUninstall then begin
    if RegQueryStringValue(HKCU, 'Control Panel\Desktop', 'SCRNSAVE.EXE', CurScr) then begin
      if Pos('FlipClockSaver.scr', CurScr) > 0 then
        RegDeleteValue(HKCU, 'Control Panel\Desktop', 'SCRNSAVE.EXE');
    end;
  end;
end;

// ============================================================
// 安装前校验:必须管理员权限
// ============================================================
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsAdminInstallMode then begin
    SuppressibleMsgBox('本安装程序需要管理员权限才能完成。', mbError, MB_OK, IDOK);
    Result := False;
  end;
end;
