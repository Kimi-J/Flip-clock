using System;
using System.Windows;

namespace FlipClockSaver;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var args = e.Args;

        // 无参数时默认运行屏保(双击 .scr 等效于 /s)
        if (args.Length == 0)
        {
            ShowSaver();
            return;
        }

        var cmd = args[0].ToLowerInvariant();

        if (cmd.StartsWith("/s") || cmd.StartsWith("-s"))
        {
            // 屏保运行模式
            ShowSaver();
        }
        else if (cmd.StartsWith("/c") || cmd.StartsWith("-c"))
        {
            // 配置模式(/c 或 /c:<hwnd>)
            ShowConfig();
        }
        else if (cmd.StartsWith("/p") || cmd.StartsWith("-p"))
        {
            // 预览模式(/p <hwnd>):嵌入控制面板"屏幕保护程序设置"中的小显示器。
            // 控制面板传过来的第二个参数是预览容器窗口的 HWND(十进制字符串)。
            if (args.Length < 2 || !long.TryParse(args[1], out var hwndVal))
            {
                // 缺少 HWND 或格式非法,直接退出(控制面板会显示空白,但不崩溃)
                Shutdown();
                return;
            }
            ShowPreview(new IntPtr(hwndVal));
        }
        else
        {
            // 未知参数,默认运行屏保
            ShowSaver();
        }
    }

    private void ShowSaver()
    {
        var window = new SaverWindow();
        window.Show();
    }

    private void ShowConfig()
    {
        var window = new ConfigWindow();
        window.Show();
    }

    private void ShowPreview(IntPtr parentHwnd)
    {
        // 预览模式使用 WinForms 窗口(WPF 窗口无法 SetParent 到预览容器)
        // WPF 应用混合使用 WinForms 时,需先启用 WinForms 视觉样式
        System.Windows.Forms.Application.EnableVisualStyles();
        var preview = new PreviewWindow(parentHwnd);
        preview.Show();
    }
}
