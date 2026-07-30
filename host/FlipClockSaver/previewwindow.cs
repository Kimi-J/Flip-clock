using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace FlipClockSaver;

/// <summary>
/// 屏保预览窗口(/p &lt;hwnd&gt; 模式)。
///
/// 控制面板"屏幕保护程序设置"中的小显示器需要把屏保画面嵌入到指定 HWND 中。
/// WPF 窗口无法通过 SetParent 嵌入(WPF 顶层窗口句柄受 HwndSource 管理,改父会崩溃),
/// 因此使用 WinForms Form:
///   1. 创建一个普通 WinForms Form
///   2. 用 SetParent 把它的 HWND 挂到控制面板传入的预览容器 HWND 上
///   3. 修改窗口样式为 WS_CHILD(子窗口),去掉标题栏/边框
///   4. 按父窗口客户区大小铺满,并在其中放 WinForms 版 WebView2 加载屏保页面
/// </summary>
public class PreviewWindow : Form
{
    private readonly IntPtr _parentHwnd;
    private Microsoft.Web.WebView2.WinForms.WebView2? _webView;

    // Win32 API
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    // 窗口样式常量
    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;
    private const int WS_CHILD = 0x40000000;
    private const int WS_VISIBLE = 0x10000000;
    private const int WS_CAPTION = 0x00C00000;
    private const int WS_THICKFRAME = 0x00040000;
    private const int WS_DLGFRAME = 0x00400000;
    private const int WS_POPUP = unchecked((int)0x80000000);
    private const int WS_EX_APPWINDOW = 0x00040000;

    public PreviewWindow(IntPtr parentHwnd)
    {
        _parentHwnd = parentHwnd;

        // 基础样式:无边框、不在任务栏显示
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        ControlBox = false;
        MaximizeBox = false;
        MinimizeBox = false;
        Text = string.Empty;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;

        // 先获取父窗口客户区大小,设置初始尺寸
        GetClientRect(_parentHwnd, out var rect);
        var w = rect.Right - rect.Left;
        var h = rect.Bottom - rect.Top;
        if (w <= 0) w = 152;
        if (h <= 0) h = 112;
        Size = new Size(w, h);
        Location = new Point(0, 0);

        Load += OnLoad;
        FormClosed += OnClosed;
    }

    private async void OnLoad(object? sender, EventArgs e)
    {
        var myHandle = this.Handle;

        // 1. 把窗口嵌入控制面板预览容器
        SetParent(myHandle, _parentHwnd);

        // 2. 修改窗口样式:去掉 popup/caption/thickframe,加上 WS_CHILD | WS_VISIBLE
        int style = GetWindowLong(myHandle, GWL_STYLE);
        style &= ~WS_POPUP;
        style &= ~WS_CAPTION;
        style &= ~WS_THICKFRAME;
        style &= ~WS_DLGFRAME;
        style |= WS_CHILD | WS_VISIBLE;
        SetWindowLong(myHandle, GWL_STYLE, style);

        // 扩展样式:去掉 WS_EX_APPWINDOW(避免在任务栏闪现)
        int exStyle = GetWindowLong(myHandle, GWL_EXSTYLE);
        exStyle &= ~WS_EX_APPWINDOW;
        SetWindowLong(myHandle, GWL_EXSTYLE, exStyle);

        // 3. 按父窗口客户区大小铺满
        GetClientRect(_parentHwnd, out var rect);
        MoveWindow(myHandle, 0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top, true);

        // 4. 创建 WinForms 版 WebView2 加载屏保页面
        _webView = new Microsoft.Web.WebView2.WinForms.WebView2
        {
            Dock = DockStyle.Fill,
        };
        Controls.Add(_webView);

        await _webView.EnsureCoreWebView2Async();

        var distPath = SaverWindow.FindDistFolderPublic();
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "appassets.local",
            distPath,
            CoreWebView2HostResourceAccessKind.Allow);

        // 加载屏保运行态页面(预览和 /s 模式共用同一页面)
        _webView.CoreWebView2.Navigate("https://appassets.local/index.html?mode=saver");
        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
    }

    private void OnClosed(object? sender, FormClosedEventArgs e)
    {
        _webView?.Dispose();
    }
}
