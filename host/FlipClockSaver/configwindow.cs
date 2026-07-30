using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace FlipClockSaver;

/// <summary>
/// 配置窗口(/c 模式):固定尺寸,嵌入 WebView2 加载 dist/index.html?mode=config。
/// 用户可在此切换主题、时间制式、显示项、背景效果等。
/// </summary>
public class ConfigWindow : Window
{
    public ConfigWindow()
    {
        Title = "Flip Clock 设置";
        Width = 480;
        Height = 640;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.CanMinimize;
        Background = Brushes.Black;

        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var webView = new Microsoft.Web.WebView2.Wpf.WebView2();
        Content = webView;

        await webView.EnsureCoreWebView2Async();

        var distPath = SaverWindow.FindDistFolderPublic();
        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "appassets.local",
            distPath,
            CoreWebView2HostResourceAccessKind.Allow);

        webView.CoreWebView2.Navigate("https://appassets.local/index.html?mode=config");
        webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
    }
}
