using System;
using System.IO;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace FlipClockSaver;

/// <summary>
/// 屏保运行窗口:全屏无边框,嵌入 WebView2 加载 dist/index.html?mode=saver。
/// 鼠标移动/点击/按键即退出(由 InputHook 全局钩子捕获)。
/// </summary>
public class SaverWindow : Window
{
    private CoreWebView2? _webView;
    private InputHook? _inputHook;

    public SaverWindow()
    {
        // 全屏无边框,置顶,覆盖所有显示器
        WindowStyle = WindowStyle.None;
        WindowState = WindowState.Maximized;
        Topmost = true;
        Cursor = System.Windows.Input.Cursors.None;
        Background = Brushes.Black;
        ShowInTaskbar = false;
        ResizeMode = ResizeMode.NoResize;

        // 覆盖整个虚拟屏幕(所有显示器)
        Left = SystemParameters.VirtualScreenLeft;
        Top = SystemParameters.VirtualScreenTop;
        Width = SystemParameters.VirtualScreenWidth;
        Height = SystemParameters.VirtualScreenHeight;

        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // 安装输入钩子:鼠标移动/点击/按键即退出
        _inputHook = new InputHook(threshold: 3);
        _inputHook.ExitRequested += () => Dispatcher.Invoke(Close);

        // 创建 WebView2 控件
        var webView = new Microsoft.Web.WebView2.Wpf.WebView2();
        Content = webView;

        await webView.EnsureCoreWebView2Async();
        _webView = webView.CoreWebView2;

        // 映射 dist 目录到虚拟主机名,实现本地静态资源加载
        var distPath = FindDistFolderPublic();
        _webView.SetVirtualHostNameToFolderMapping(
            "appassets.local",
            distPath,
            CoreWebView2HostResourceAccessKind.Allow);

        // 加载屏保运行态页面
        _webView.Navigate("https://appassets.local/index.html?mode=saver");

        // 禁用右键菜单和开发者工具(屏保不应暴露这些)
        _webView.Settings.AreDefaultContextMenusEnabled = false;
        _webView.Settings.AreDevToolsEnabled = false;
    }

    /// <summary>
    /// 查找 dist 文件夹:优先在 exe 同级目录找,其次在项目结构中找(开发时)。
    /// </summary>
    internal static string FindDistFolderPublic()
    {
        var baseDir = AppContext.BaseDirectory;
        // 发布后:dist 与 .scr 同级
        var distPath = Path.Combine(baseDir, "dist");
        if (Directory.Exists(distPath)) return distPath;

        // 开发时:从 host/FlipClockSaver/bin/... 回溯到项目根的 dist
        var dir = new DirectoryInfo(baseDir);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, "dist");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException("找不到 dist 文件夹,请先运行 npm run build");
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _inputHook?.Dispose();
    }
}
