using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace FlipClockSaver;

/// <summary>
/// 低级别输入钩子:捕获全局鼠标移动/点击/键盘按键,用于屏保退出。
/// 使用 WH_MOUSE_LL + WH_KEYBOARD_LL 全局钩子,不受 WebView2 子窗口焦点影响。
/// </summary>
internal sealed class InputHook : IDisposable
{
    private const int WH_MOUSE_LL = 14;
    private const int WH_KEYBOARD_LL = 13;

    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    private readonly IntPtr _mouseHook;
    private readonly IntPtr _keyboardHook;
    private readonly LowLevelProc _mouseProc;
    private readonly LowLevelProc _keyboardProc;

    private Point _initialMousePos;
    private readonly double _threshold;

    public event Action? ExitRequested;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    /// <param name="threshold">鼠标移动超过此距离(像素)触发退出</param>
    public InputHook(double threshold = 3)
    {
        _threshold = threshold;
        _mouseProc = MouseHookProc;
        _keyboardProc = KeyboardHookProc;

        using var process = Process.GetCurrentProcess();
        using var module = process.MainModule!;
        var hMod = GetModuleHandle(module.ModuleName!);

        _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, hMod, 0);
        _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, hMod, 0);

        GetCursorPos(out var pt);
        _initialMousePos = new Point(pt.X, pt.Y);
    }

    private IntPtr MouseHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_MOUSEMOVE)
            {
                GetCursorPos(out var pt);
                var current = new Point(pt.X, pt.Y);
                var dx = current.X - _initialMousePos.X;
                var dy = current.Y - _initialMousePos.Y;
                if (Math.Sqrt(dx * dx + dy * dy) > _threshold)
                {
                    ExitRequested?.Invoke();
                }
                _initialMousePos = current;
            }
            else if (msg is WM_LBUTTONDOWN or WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_MOUSEWHEEL)
            {
                ExitRequested?.Invoke();
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private IntPtr KeyboardHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg is WM_KEYDOWN or WM_SYSKEYDOWN)
            {
                ExitRequested?.Invoke();
            }
        }
        return CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
        if (_keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(_keyboardHook);
    }
}
