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
            // 预览模式(/p <hwnd>) — 暂不支持,直接退出
            Shutdown();
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
}
