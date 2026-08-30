# Windows 系统下鼠标光标隐藏机制深度研究

> 研究主题：Windows 桌面软件如何隐藏鼠标光标、何时能够隐藏、相关系统 API、以及如何实现“鼠标长时间不动后自动隐藏”  
> 研究日期：2026-08-28  
> 适用范围：Win32 桌面应用为主，补充 WinForms / WPF / UWP / Windows App SDK（WinUI）  
> 结论可信度：高。核心结论以 Microsoft Learn / Windows 官方工程博客 The Old New Thing 为主要依据。

---

## 1. 结论摘要

Windows 的“鼠标隐藏”不是一个单一机制，而是至少可以分成以下几层：

1. **显示计数器（show count）层**：`ShowCursor(FALSE)` 令内部显示计数减 1；只有计数 `< 0` 时才不绘制鼠标。Win32 时代该状态是与线程/输入队列相关的，而不是一个真正的全局布尔开关。
2. **当前光标句柄层**：`SetCursor(NULL)` 会把当前光标图像从屏幕移除；但只调用一次往往不够，因为后续 `WM_SETCURSOR` / `DefWindowProc` 可能再次把窗口类光标设置回来。
3. **窗口光标选择层**：Windows 在鼠标移动、命中测试时通过 `WM_SETCURSOR` 决定当前应该显示什么光标。应用处理该消息并返回 `TRUE`，即可阻止默认逻辑继续覆盖。
4. **系统自动抑制层**：Windows 8 起 `GetCursorInfo` 还能看到 `CURSOR_SUPPRESSED`，表示系统因触摸/笔输入主动不绘制传统鼠标指针。这和应用调用 `ShowCursor` 隐藏不是同一种状态。
5. **Mouse Vanish 层**：Windows 有系统级“打字时隐藏指针”功能，使用 `SystemParametersInfo(SPI_GETMOUSEVANISH / SPI_SETMOUSEVANISH)` 查询/设置。它的触发条件是**键盘输入**，恢复条件是**鼠标移动**，不是“静止 N 秒”。
6. **框架封装层**：WinForms `Cursor.Hide()`、WPF `Cursors.None` / `Mouse.OverrideCursor`、UWP `CoreWindow.PointerCursor = null`、Windows App SDK `InputPointerSource.Cursor` 等对上述底层逻辑做了封装或提供框架级替代方案。

### 最关键结论

**Windows 没有公开的、通用的“鼠标静止 N 秒后自动隐藏”的系统设置/API。**

视频播放器、图片浏览器、全屏演示、游戏等软件中常见的“2~5 秒鼠标不动就隐藏，鼠标一动立刻显示”，通常由应用程序自己实现：

```text
鼠标发生活动
   ↓
记录 lastMouseActivity / 重置定时器
   ↓
超过 idleThreshold 且窗口仍前台、鼠标仍在本应用区域
   ↓
隐藏 cursor
   ↓
收到下一次鼠标移动/按键/滚轮
   ↓
立即显示 cursor，并重新开始计时
```

推荐的 Win32 工程实现是：

- **应用窗口内部隐藏**：优先用 `WM_SETCURSOR + SetCursor(NULL)` 做成显式状态机；
- **鼠标静止时间检测**：前台窗口内用 `WM_MOUSEMOVE`；需要相对移动/高精度/后台输入时用 Raw Input (`WM_INPUT`)；
- **定时**：UI 简单场景用 `SetTimer`，复杂线程模型可以用 Thread Pool Timer；
- **恢复**：任何真实鼠标移动时立即恢复，同时在失去激活、鼠标离开窗口、退出全屏、销毁窗口时强制恢复；
- **不要为了应用局部隐藏去改系统光标方案**，也不要把 `SetSystemCursor` 当普通隐藏 API。

---

## 2. Windows 光标的核心模型：不是简单的 Visible=true/false

### 2.1 “屏幕上只有一个鼠标指针”与“状态线程化”并不矛盾

从用户视觉角度看，系统只有一个鼠标指针。Windows Accessibility 的 `OBJID_CURSOR` 文档也明确说明系统只有一个 mouse pointer。

但是，在 Win32 的输入模型中，**光标形状、显示计数等状态被虚拟化到线程/输入队列**。Raymond Chen 解释过：16 位 Windows 时代光标 show count 是全局状态；迁移到 Win32 后变成了线程相关状态。若多个线程通过 `AttachThreadInput` 共享输入队列，这些状态也会被共享。

因此：

- 一个 UI 线程调用 `ShowCursor(FALSE)`，并不等于“整个 Windows 桌面永远没有鼠标”；
- 当鼠标移动到属于另一个输入队列/线程的窗口时，那个窗口自己的 cursor 状态会重新成为决定因素；
- 多 UI 线程应用中，不能假定一次 `ShowCursor` 就能控制所有窗口。

这也是为什么**按窗口处理 `WM_SETCURSOR` 往往比盲目维护一个全局隐藏状态更稳定**。

参考：ShowCursor 官方文档 [1]，Raymond Chen 对 ShowCursor 历史与线程局部状态的解释 [14]。

---

## 3. 方法一：`ShowCursor` —— 显示计数器模型

### 3.1 API

```cpp
int ShowCursor(BOOL bShow);
```

规则：

- `ShowCursor(TRUE)`：内部显示计数 `+1`
- `ShowCursor(FALSE)`：内部显示计数 `-1`
- 只有当显示计数 **>= 0** 时鼠标才显示
- 有鼠标设备时，传统初始计数通常是 `0`

因此：

```cpp
ShowCursor(FALSE); // 0 -> -1，隐藏
ShowCursor(TRUE);  // -1 -> 0，恢复
```

### 3.2 最大的工程坑：它不是 SetVisible(false)

错误理解：

```cpp
ShowCursor(FALSE); // “设置成隐藏”
```

真实语义更接近：

```text
cursorShowCount--
```

所以如果某段代码多调用了一次 `ShowCursor(FALSE)`：

```text
0 -> -1 -> -2
```

之后你只调用一次 `ShowCursor(TRUE)`：

```text
-2 -> -1
```

鼠标依然不可见。

这也是 WinForms 官方文档强调 `Cursor.Hide()` / `Cursor.Show()` **必须成对平衡**的原因 [16]。

### 3.3 是否应该使用 while 循环把计数“压到隐藏”或“拉到显示”？

网络上常见：

```cpp
while (ShowCursor(FALSE) >= 0) {}
```

它确实可以强行把计数推到负数，但会改变调用者看不见的历史计数状态，使后续恢复更难做对。如果应用和第三方组件、游戏引擎、GUI 框架都可能调用 `ShowCursor`，这种“归一化计数”的写法很容易造成状态所有权混乱。

更推荐：

- 自己维护 `cursorHiddenByMe`；
- 每次进入隐藏模式只调用一次 Hide；
- 每次退出只调用一次 Show；
- 更复杂的普通窗口 UI，优先改用 `WM_SETCURSOR + SetCursor(NULL)`，避免共享计数器模型。

### 3.4 适合场景

`ShowCursor` 更适合：

- 全屏幻灯片；
- 全屏视频模式；
- 游戏进入 mouselook / relative mouse 模式；
- 明确的“进入隐藏模式 / 离开隐藏模式”状态。

不太适合：

- 一个复杂窗口中只有局部控件要隐藏；
- 多 UI 线程；
- 第三方组件频繁切换 cursor；
- 需要非常明确的“鼠标在哪个 child HWND 上就隐藏哪个”的行为。

---

## 4. 方法二：`SetCursor(NULL)` —— 当前光标图像为空

### 4.1 API

```cpp
HCURSOR SetCursor(HCURSOR hCursor);
```

官方文档明确：

```cpp
SetCursor(NULL);
```

会把当前 cursor 从屏幕移除 [2]。

### 4.2 为什么 `SetCursor(NULL)` 经常“只隐藏一下，一动鼠标又出现”？

因为 Windows 的 cursor 不是设置一次后永久不动。

鼠标在窗口内移动时，系统会发送 `WM_SETCURSOR`。如果你的代码不处理，`DefWindowProc` 会执行默认逻辑：

1. 先把 `WM_SETCURSOR` 给父窗口机会处理；
2. 如果父窗口没有处理：
   - 在 client area 使用窗口类注册的 class cursor；
   - 在非 client area 使用系统合适的箭头/resize cursor。

因此，如果窗口类中有一个非空 `hCursor`，你只是某一时刻执行：

```cpp
SetCursor(NULL);
```

下一次鼠标移动时，默认 `WM_SETCURSOR` 处理就可能重新执行：

```text
SetCursor(classCursor)
```

于是鼠标又出来了。

Microsoft `SetCursor` 文档也特别提醒：如果应用需要在窗口中自己持续设置 cursor，应该确保窗口类 cursor 为 `NULL`，否则系统会在鼠标移动时恢复 class cursor [2]。

### 4.3 正确的持续隐藏方式

更稳定的 Win32 模式：

```cpp
case WM_SETCURSOR:
    if (LOWORD(lParam) == HTCLIENT) {
        if (g_cursorHidden) {
            SetCursor(nullptr);
        } else {
            SetCursor(LoadCursor(nullptr, IDC_ARROW));
        }
        return TRUE; // 告诉系统：我已经决定 cursor，不要继续默认处理
    }
    break;
```

同时，窗口类最好注册为：

```cpp
wc.hCursor = nullptr;
```

这样不会再存在一个 class cursor 在每次移动时“抢回控制权”。

### 4.4 应用什么时候“应该”设置 cursor？

Microsoft 文档给了一个非常重要的边界：

> 窗口应该只在鼠标位于自己的 client area，或者该窗口正在捕获鼠标输入时设置 cursor。

即：

```text
(pointer inside my client area) OR (my window owns mouse capture)
```

这是应用局部隐藏的合理作用域。

如果鼠标已经离开你的窗口，就应该恢复，不要继续把别的程序的 pointer 状态当成自己的资源控制。

---

## 5. `WM_SETCURSOR`：理解 Windows 光标隐藏的关键消息

### 5.1 消息触发条件

`WM_SETCURSOR` 会在鼠标导致 cursor 在窗口内移动、且鼠标输入没有被 capture 时发送 [3]。

关键参数：

```cpp
LOWORD(lParam)  // hit-test，如 HTCLIENT / HTCAPTION / HTLEFT 等
HIWORD(lParam)  // 触发该事件的鼠标消息，如 WM_MOUSEMOVE
```

所以你可以做到：

- client area 隐藏；
- 标题栏保持箭头；
- 窗口边框仍显示 resize cursor；
- 特定控件区域显示 hand / IBeam；
- 全屏 borderless 窗口全部隐藏。

### 5.2 返回 TRUE 的意义

如果应用处理 `WM_SETCURSOR` 后返回 `TRUE`，Windows 停止后续处理。

如果返回 `FALSE` 或交给 `DefWindowProc`，默认光标逻辑会继续。

因此“我刚 SetCursor(NULL)，为什么马上被改回去”的本质经常是：

```text
应用设成 NULL
   ↓
下一次 WM_SETCURSOR
   ↓
DefWindowProc
   ↓
恢复 class cursor / 系统 cursor
```

### 5.3 child window 情况

默认实现会先把 `WM_SETCURSOR` 交给父窗口；父窗口如果返回 `TRUE`，可统一控制 child window 的 cursor。

这对于：

- 视频播放 surface；
- 自绘 UI；
- 多 child HWND 的全屏播放器；
- 老式 Win32 控件容器；

非常有用。

---

## 6. 窗口类光标：`GCLP_HCURSOR`

窗口类在 `WNDCLASSEX::hCursor` 中可以声明默认 cursor。

运行时也可以用：

```cpp
SetClassLongPtr(hwnd, GCLP_HCURSOR, ...);
```

改变该类关联的 cursor [6]。

但是需要注意：**这是 window class 级别，而非单个 HWND 的普通属性**。同一个 class 的其他窗口也可能受影响。

如果你准备完全自己处理 `WM_SETCURSOR`，典型选择是 class cursor 为 `NULL`，并在消息中明确设置隐藏或正常 cursor。

2025 年 Raymond Chen 还专门解释过：class cursor 是 `nullptr` 并不等于“Windows 自动帮你隐藏”。它的真正含义是“默认流程没有 cursor 可设置，因此当前已有 cursor 可能继续保持原样”。所以如果选择 `hCursor = nullptr`，应用就应该承担 cursor 管理责任 [15]。

---

## 7. 如何判断鼠标现在究竟是“显示、隐藏还是被系统抑制”

### 7.1 `GetCursorInfo`

```cpp
BOOL GetCursorInfo(PCURSORINFO pci);
```

结构：

```cpp
typedef struct tagCURSORINFO {
    DWORD   cbSize;
    DWORD   flags;
    HCURSOR hCursor;
    POINT   ptScreenPos;
} CURSORINFO;
```

`flags` 关键值：

| flags | 含义 |
|---|---|
| `0` | cursor hidden |
| `CURSOR_SHOWING (0x1)` | cursor nominally showing |
| `CURSOR_SUPPRESSED (0x2)` | Windows 因 touch/pen 输入抑制传统 pointer 绘制 |

`CURSOR_SUPPRESSED` 从 Windows 8 起尤其重要 [4][5]。

### 7.2 “hidden” 与 “suppressed” 不一样

如果：

```text
CURSOR_SHOWING = 1
CURSOR_SUPPRESSED = 1
```

可以理解为：cursor 从应用的逻辑状态看仍应显示，但系统由于触摸/笔交互暂时没有绘制它。

所以测试自动隐藏逻辑时，不应只凭“肉眼没看到 cursor”就断定一定是你自己的 `ShowCursor(FALSE)` 生效。

### 7.3 监听 cursor show/hide/change

如果在诊断工具中需要监听系统 cursor 变化，可以使用：

```cpp
SetWinEventHook(...)
```

并筛选：

- `OBJID_CURSOR`
- `EVENT_OBJECT_SHOW`
- `EVENT_OBJECT_HIDE`
- `EVENT_OBJECT_NAMECHANGE`

官方 Accessibility 文档确认 `EVENT_OBJECT_SHOW/HIDE` 会对 cursor 产生事件，而 `OBJID_CURSOR` 表示系统 mouse pointer [20]。

这适合做：

- cursor 状态分析器；
- 自动化测试；
- 查找是谁把 cursor 隐藏/显示；
- 录屏工具的 cursor 监控。

普通应用的自动隐藏功能不需要为此安装全局 hook。

---

## 8. Windows 自带的 Mouse Vanish：“打字时隐藏”，不是“静止隐藏”

Windows 有一个很容易与自动隐藏混淆的系统功能：**Mouse Vanish**。

系统行为：

```text
用户开始键盘输入
   ↓
系统隐藏 mouse pointer
   ↓
用户移动鼠标
   ↓
pointer 重新出现
```

官方 Mouse Input Overview 将它描述为：键入时隐藏 pointer，鼠标移动时恢复，以避免 pointer 遮挡正在输入的文字 [10]。

### 8.1 查询

```cpp
BOOL enabled = FALSE;
SystemParametersInfo(
    SPI_GETMOUSEVANISH,
    0,
    &enabled,
    0);
```

### 8.2 设置

```cpp
BOOL enabled = TRUE;
SystemParametersInfo(
    SPI_SETMOUSEVANISH,
    0,
    reinterpret_cast<PVOID>(TRUE),
    SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
```

实际调用时应按照 `SystemParametersInfo` 对该 action 的 `pvParam` 约定传入 BOOL 值。`SPI_SETMOUSEVANISH` 官方定义为打开/关闭 Vanish 功能，默认值为 off [9]。

### 8.3 不建议普通业务软件擅自改它

`SystemParametersInfo` 的说明指出，这类接口主要用于允许用户自定义环境的应用。

因此普通播放器/游戏不要为了自己的 UI 自动隐藏，偷偷把用户的系统 “Hide pointer while typing” 设置改掉。

正确做法是：

- 查询它以做兼容性判断：可以；
- 提供明确的用户设置页面后修改：可以；
- 为了自己窗口 3 秒隐藏 pointer 而修改系统设置：不应该。

---

## 9. “鼠标长时间不动自动隐藏”的正确建模

这里最重要的是先定义“长时间不动”究竟是什么意思。

### 9.1 四种不同语义

| 语义 | 推荐输入源 | 备注 |
|---|---|---|
| 鼠标在**本窗口**没有移动 | `WM_MOUSEMOVE` | 最常见的视频播放器模式 |
| 物理鼠标设备没有产生相对移动 | Raw Input `WM_INPUT` | 适合游戏、relative mode、高精度设备 |
| 当前登录 session 完全没有用户输入 | `GetLastInputInfo` | 键盘也算活动，不是“mouse-only” |
| pointer 在一个小区域内停留了一段时间 | `TrackMouseEvent(TME_HOVER)` | 是 hover 语义，不是严格静止 |

如果产品需求写的是：

> “鼠标 3 秒不动隐藏”

通常应该选择第一种或第二种，而不是 `GetLastInputInfo`。

---

## 10. 方案 A：`WM_MOUSEMOVE + SetTimer` —— 普通播放器/全屏 UI 的首选

### 10.1 原理

每次收到鼠标活动：

1. 若 cursor 已隐藏，立即显示；
2. 更新活动时间；
3. 重置一次 3 秒 timer；
4. 3 秒 timer 到期时检查窗口仍前台、pointer 仍在 client area；
5. 满足条件才隐藏。

### 10.2 为什么 `SetTimer` 很合适

`SetTimer(hwnd, sameId, timeout, ...)` 如果同一个窗口已有同 ID timer，会替换并**重置** timer [11]。

因此非常自然：

```cpp
SetTimer(hwnd, ID_CURSOR_IDLE, 3000, nullptr);
```

每次 `WM_MOUSEMOVE` 再调用一次，就相当于重新从 3 秒开始计时。

注意：`WM_TIMER` 是低优先级消息，只有消息队列里没有更高优先级消息时才被投递。因此它不是硬实时 timer，但对“3 秒左右隐藏鼠标”完全足够 [12]。

### 10.3 推荐状态机

```text
                    idle >= 3000 ms
VISIBLE  ---------------------------------->  HIDDEN
   ^                                            |
   |                                            |
   +------------ mouse activity ---------------+

任何状态：
- 窗口失去前台 -> VISIBLE
- 鼠标离开 client -> VISIBLE
- 退出全屏 -> VISIBLE
- 开始拖拽/resize -> 通常 VISIBLE
- 程序退出 -> 恢复状态
```

### 10.4 推荐 Win32 示例

下面这个实现刻意避免用 `ShowCursor` 计数器，而用 `WM_SETCURSOR + SetCursor` 管理本窗口 client area。

```cpp
#include <windows.h>
#include <windowsx.h>

static constexpr UINT_PTR kCursorIdleTimer = 1;
static constexpr UINT kCursorIdleMs = 3000;

static bool g_cursorHidden = false;
static bool g_trackingLeave = false;

static HCURSOR NormalCursor()
{
    return LoadCursor(nullptr, IDC_ARROW);
}

static bool IsPointerInClient(HWND hwnd)
{
    POINT pt{};
    if (!GetCursorPos(&pt))
        return false;

    if (!ScreenToClient(hwnd, &pt))
        return false;

    RECT rc{};
    GetClientRect(hwnd, &rc);
    return PtInRect(&rc, pt) != FALSE;
}

static void ShowAppCursor(HWND hwnd)
{
    if (!g_cursorHidden)
        return;

    g_cursorHidden = false;

    // SetCursor 文档建议：只在 pointer 位于自己的 client area，
    // 或窗口拥有 mouse capture 时设置 cursor。
    if (IsPointerInClient(hwnd) || GetCapture() == hwnd)
        SetCursor(NormalCursor());
}

static void HideAppCursor(HWND hwnd)
{
    if (g_cursorHidden)
        return;

    if (GetForegroundWindow() != hwnd)
        return;

    if (!IsPointerInClient(hwnd))
        return;

    g_cursorHidden = true;
    SetCursor(nullptr);
}

static void RearmCursorIdleTimer(HWND hwnd)
{
    SetTimer(hwnd, kCursorIdleTimer, kCursorIdleMs, nullptr);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg)
    {
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT)
        {
            SetCursor(g_cursorHidden ? nullptr : NormalCursor());
            return TRUE;
        }
        break;

    case WM_MOUSEMOVE:
        // 第一次真实移动就立即恢复，不必等下一次 WM_SETCURSOR。
        ShowAppCursor(hwnd);
        RearmCursorIdleTimer(hwnd);

        if (!g_trackingLeave)
        {
            TRACKMOUSEEVENT tme{};
            tme.cbSize = sizeof(tme);
            tme.dwFlags = TME_LEAVE;
            tme.hwndTrack = hwnd;
            if (TrackMouseEvent(&tme))
                g_trackingLeave = true;
        }
        return 0;

    case WM_LBUTTONDOWN:
    case WM_RBUTTONDOWN:
    case WM_MBUTTONDOWN:
    case WM_MOUSEWHEEL:
        // 是否把点击/滚轮也算“鼠标活动”由产品定义；播放器通常算。
        ShowAppCursor(hwnd);
        RearmCursorIdleTimer(hwnd);
        break;

    case WM_MOUSELEAVE:
        g_trackingLeave = false;
        KillTimer(hwnd, kCursorIdleTimer);
        ShowAppCursor(hwnd);
        return 0;

    case WM_TIMER:
        if (wParam == kCursorIdleTimer)
        {
            KillTimer(hwnd, kCursorIdleTimer);
            HideAppCursor(hwnd);
            return 0;
        }
        break;

    case WM_ACTIVATEAPP:
        if (!wParam)
        {
            KillTimer(hwnd, kCursorIdleTimer);
            ShowAppCursor(hwnd);
        }
        else
        {
            RearmCursorIdleTimer(hwnd);
        }
        return 0;

    case WM_DESTROY:
        KillTimer(hwnd, kCursorIdleTimer);
        ShowAppCursor(hwnd);
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, msg, wParam, lParam);
}
```

### 10.5 窗口类注册建议

如果采用上述逻辑：

```cpp
WNDCLASSEX wc{};
wc.hCursor = nullptr;
```

由 `WM_SETCURSOR` 完全负责 client cursor。

如果 class cursor 仍为 `IDC_ARROW`，那么你需要确保自己的 `WM_SETCURSOR` 一直返回 `TRUE`，否则某次默认处理会把箭头恢复出来。

---

## 11. 方案 B：Raw Input —— 游戏、相对移动、后台检测

传统 `WM_MOUSEMOVE` 的特点是：它描述 GUI pointer 在窗口中的移动。

如果应用需要：

- FPS / 3D camera 的 relative mouse movement；
- 鼠标 cursor 被锁到屏幕中心；
- cursor 位置本身不变化，但鼠标设备仍在产生 delta；
- 高精度鼠标；
- 合理的后台输入场景；

应考虑 Raw Input。

### 11.1 注册鼠标 Raw Input

鼠标 HID usage：

```cpp
RAWINPUTDEVICE rid{};
rid.usUsagePage = 0x01; // Generic Desktop Controls
rid.usUsage     = 0x02; // Mouse
rid.dwFlags     = 0;
rid.hwndTarget  = hwnd;

RegisterRawInputDevices(&rid, 1, sizeof(rid));
```

之后收到：

```cpp
WM_INPUT
```

再用：

```cpp
GetRawInputData(...)
```

取得 `RAWMOUSE` 的相对移动数据。

### 11.2 后台输入

如果设置：

```cpp
RIDEV_INPUTSINK
```

并指定 `hwndTarget`，应用即使不在 foreground 也可以收到 raw input [7][8]。

但这不意味着普通播放器应该这么做。

后台监听鼠标属于影响范围更大的设计，应只在有明确产品理由时使用。普通“鼠标在我的播放器窗口里 3 秒不动”完全没必要监听整个 session 的物理鼠标。

### 11.3 为什么 relative mode 不应通过 `GetCursorPos` 判断活动

很多 3D 应用会：

- 把 pointer 固定在中心；或
- 根本不使用绝对 pointer 位置；
- 只消费 relative delta。

此时：

```cpp
GetCursorPos()
```

可能长期返回几乎同一个位置，但用户实际上一直在移动鼠标。

所以“cursor position 没变”不等于“物理鼠标没动”。

这是 Raw Input 最重要的适用区别之一。

---

## 12. 方案 C：`GetLastInputInfo` —— 检测 session 用户空闲，而不是 mouse-only

API：

```cpp
BOOL GetLastInputInfo(PLASTINPUTINFO plii);
```

官方明确称它适合 **input idle detection** [13]。

示例：

```cpp
DWORD GetSessionIdleMilliseconds()
{
    LASTINPUTINFO lii{};
    lii.cbSize = sizeof(lii);

    if (!GetLastInputInfo(&lii))
        return 0;

    // DWORD 无符号减法可处理一次 32-bit tick wrap，
    // 对常规几秒/几分钟 idle 阈值足够。
    return GetTickCount() - lii.dwTime;
}
```

### 12.1 它适合什么

适合：

- 屏保式逻辑；
- session 用户长期没有输入；
- kiosk idle；
- “用户没有操作电脑”而非“鼠标没有动”。

### 12.2 它不适合什么

如果需求是：

> 用户在键盘打字，但鼠标 5 秒没动，也要把鼠标指针隐藏。

那 `GetLastInputInfo` 不是合适的输入源，因为键盘输入也会让“last input”更新。

也就是说：

```text
mouse stationary + keyboard typing
```

对于 `GetLastInputInfo` 而言仍然是“用户活跃”。

### 12.3 session 范围

Microsoft 特别说明：

- 它不是跨所有 Windows session 的全局状态；
- 它只返回调用进程所在 session 的 last input。

这对 RDP / Fast User Switching / 多用户服务器尤其重要。

### 12.4 时间值异常

官方还提醒 `LASTINPUTINFO.dwTime` 不保证严格单调递增，例如 raw input thread 与 desktop thread 的时间差、或 `SendInput` 注入事件自带时间戳都可能造成前后值异常。

因此如果你需要**应用内部精确 mouse-only inactivity**，最好直接在自己的鼠标事件到达时记录 `GetTickCount64()`，不要把 `GetLastInputInfo` 当成鼠标活动数据库。

---

## 13. 方案 D：`TrackMouseEvent(TME_HOVER)` —— 能做“停留”，但不是最准确的 idle 方案

`TrackMouseEvent` 可以要求系统在 pointer 在一个矩形中停留指定时间后发送：

```cpp
WM_MOUSEHOVER
```

结构：

```cpp
TRACKMOUSEEVENT tme{};
tme.cbSize = sizeof(tme);
tme.dwFlags = TME_HOVER | TME_LEAVE;
tme.hwndTrack = hwnd;
tme.dwHoverTime = 3000;
TrackMouseEvent(&tme);
```

### 13.1 它和“鼠标完全没动 3 秒”不是同一件事

Windows 对 hover 的定义是：pointer 在指定的 **hover rectangle** 内停留一段时间。

系统默认 hover rectangle 大小可通过：

- `SPI_GETMOUSEHOVERWIDTH`
- `SPI_GETMOUSEHOVERHEIGHT`

查询；默认 hover timeout 可通过：

- `SPI_GETMOUSEHOVERTIME`

查询 [17]。

所以用户在这个小矩形中轻微移动，也可能仍然被视为 hover。

对于 tooltip，这是正确语义；对于“严格 mouse inactivity”，它不是最清晰的建模。

### 13.2 另一个特性：hover tracking 是一次性的

收到 `WM_MOUSEHOVER` 后 tracking 会停止，需要再次调用 `TrackMouseEvent` 才能继续。

因此实际播放器代码通常还是“WM_MOUSEMOVE 重置自己的 timer”更简单。

---

## 14. 为什么不推荐轮询 `GetCursorPos` 作为主方案

简单实现可能每 100ms：

```cpp
GetCursorPos(&pt);
if (pt == oldPt) idle += 100;
```

优点：

- 非常容易写；
- 不需要修改窗口消息处理。

缺点：

1. 额外周期唤醒，能效更差；
2. 相对鼠标模式下位置可能固定，错误判断为 idle；
3. 远程/虚拟输入、触摸转鼠标等语义更复杂；
4. 需要自己处理 DPI/多屏/窗口范围；
5. 事件驱动的 Windows UI 本身已经会给你 `WM_MOUSEMOVE`。

所以：

- 普通 UI 用 `WM_MOUSEMOVE`；
- 游戏/高精度用 Raw Input；
- 不建议以 `GetCursorPos` polling 为首选。

---

## 15. Capture、拖拽与非客户区：自动隐藏时必须处理的边界

### 15.1 Mouse capture

`WM_SETCURSOR` 官方定义说明，它在“mouse input is not captured”时因移动而发送。

如果窗口正在：

```cpp
SetCapture(hwnd);
```

那么 cursor 更新行为和普通 hover 不完全相同。

而 `SetCursor` 文档又明确说明：拥有 capture 的窗口可以设置 cursor。

因此建议：

- 拖拽、resize、selection capture 期间通常**暂停自动隐藏**；
- 如果确实要隐藏，timer 到期时显式 `SetCursor(NULL)`；
- capture 结束时重新根据当前 pointer 位置和状态设置 cursor。

### 15.2 非 client area

窗口标题栏、边框等区域的 cursor 可能由系统表示 resize / move。

因此一般桌面窗口建议只在：

```cpp
LOWORD(lParam) == HTCLIENT
```

时应用自动隐藏。

否则用户可能把鼠标停在窗口边框 3 秒后 resize cursor 消失，影响可发现性与可用性。

全屏 borderless 窗口则通常全部是 client area，不存在这个问题。

---

## 16. Windows 触摸/笔输入的 `CURSOR_SUPPRESSED`

Windows 8 起 `CURSORINFO.flags` 有：

```cpp
CURSOR_SUPPRESSED
```

含义是：系统当前由于用户通过 touch / pen 输入，而没有绘制 traditional mouse cursor。

这意味着以下三个状态要分开：

```text
A. 应用调用 ShowCursor(FALSE) -> show count < 0
B. 应用 SetCursor(NULL) -> 当前 cursor image 为空
C. Windows touch/pen suppression -> CURSOR_SUPPRESSED
```

自动化测试如果只判断画面有没有箭头，很容易把 C 误判成 A/B。

诊断时应读取 `GetCursorInfo`。

---

## 17. 全局隐藏整个 Windows 桌面：为什么不是普通应用应该做的事

### 17.1 `ShowCursor` 不是可靠的跨应用全局隐藏开关

如前所述，Win32 中 show count 与线程/输入队列相关。

所以不要期待：

```cpp
ShowCursor(FALSE);
```

就让其他进程的所有窗口都永远没有 pointer。

### 17.2 `SetSystemCursor` technically 可以改系统 cursor，但不等于“全局 HideCursor”

API：

```cpp
BOOL SetSystemCursor(HCURSOR hcur, DWORD id);
```

它会把指定系统 cursor（如 `OCR_NORMAL`, `OCR_IBEAM`, `OCR_HAND` 等）的内容替换成你提供的 cursor，并且系统会销毁传入的 `hcur` [18]。

理论上，可以把各个 system cursor 替换成透明 cursor，从视觉上实现“很多系统 cursor 看不见”。

但这不是一个正确的普通应用自动隐藏方案，因为：

- 它修改的是用户的**系统 cursor 资源/方案**；
- 需要替换多种 OCR cursor，而不仅仅是箭头；
- 第三方应用可以使用自定义 cursor，不受影响；
- 程序崩溃或恢复失败时可能留下糟糕用户体验；
- 恢复需要 `SystemParametersInfo(SPI_SETCURSORS, 0, NULL, ...)` 重新加载系统 cursors [19]。

结论：

> `SetSystemCursor` 是“自定义系统 cursor”的 API，不是“应用隐藏自己的 mouse pointer”的 API。

除非你正在开发系统级无障碍/桌面定制工具，否则不建议使用。

---

## 18. .NET / Windows UI 框架对应关系

### 18.1 WinForms

```csharp
Cursor.Hide();
Cursor.Show();
```

Microsoft 文档明确要求 Hide/Show 调用必须平衡 [16]。

对于自动隐藏：

```csharp
private readonly System.Windows.Forms.Timer _timer = new()
{
    Interval = 3000
};

private bool _hidden;

void OnMouseMove(object? sender, MouseEventArgs e)
{
    if (_hidden)
    {
        Cursor.Show();
        _hidden = false;
    }

    _timer.Stop();
    _timer.Start();
}

void OnIdleTimeout(object? sender, EventArgs e)
{
    _timer.Stop();
    if (!_hidden && Focused)
    {
        Cursor.Hide();
        _hidden = true;
    }
}
```

仍要保证窗口失焦/关闭时 `Show()` 恢复。

### 18.2 WPF

WPF 原生提供不可见 cursor：

```csharp
Cursors.None
```

以及应用级覆盖：

```csharp
Mouse.OverrideCursor = Cursors.None;
```

恢复：

```csharp
Mouse.OverrideCursor = null;
```

官方特别说明：`OverrideCursor = Cursors.None` 会强制不显示 cursor，但 mouse events **仍然继续处理** [21]。

这非常适合实现：

```text
DispatcherTimer 3 秒
    -> Mouse.OverrideCursor = Cursors.None
PreviewMouseMove
    -> Mouse.OverrideCursor = null
```

相比 P/Invoke `ShowCursor`，WPF 项目通常优先使用 WPF 自己的 cursor abstraction。

### 18.3 UWP / CoreWindow

UWP 的 relative mouse movement 官方文档直接给出：

```cpp
CoreWindow::PointerCursor = nullptr;
```

即可隐藏 mouse cursor；退出 relative mode 时再恢复为非 null cursor [22]。

这是典型游戏 mouselook 逻辑。

### 18.4 Windows App SDK / WinUI

Windows App SDK 提供：

```text
Microsoft.UI.Input.InputPointerSource.Cursor
```

用于指定鼠标/笔 pointer 位于该 InputPointerSource 的 Visual 或 HWND 上时显示的 cursor [23]。

新项目应优先使用当前 UI 框架自己的 cursor API；只有需要 Win32 级控制或兼容老式 HWND 时再下沉到 `SetCursor` / `WM_SETCURSOR`。

---

## 19. 不同软件类型通常采用什么逻辑

### 19.1 视频播放器 / 图片浏览器

典型产品逻辑：

```text
进入全屏
  -> 显示 cursor
  -> 计时 2~3 秒

鼠标不动到期
  -> 隐藏 cursor + UI controls

鼠标移动
  -> 立即显示 cursor + controls
  -> 重置 timer

失去前台 / Esc 退出全屏
  -> cursor 必须恢复
```

推荐：`WM_MOUSEMOVE + SetTimer + WM_SETCURSOR/SetCursor(NULL)`。

### 19.2 幻灯片 / kiosk

常见逻辑：

- 一进入 presentation mode 就隐藏；
- 鼠标移动可以选择显示，也可以保持隐藏；
- Esc / 切出应用必须恢复。

可以使用 balanced `ShowCursor`，因为模式边界非常清晰。

### 19.3 FPS / 3D 编辑器

通常不是“idle hide”，而是：

```text
进入 camera-look mode
   -> capture / relative input
   -> hide system cursor

离开 camera-look mode
   -> stop relative input
   -> restore cursor
```

推荐 Raw Input / 框架 relative mouse API。

### 19.4 文本编辑器

如果需求是“打字时避免 pointer 挡住文字”，这是 Mouse Vanish 语义。

最好尊重系统用户设置，而不是每个编辑器自己重新发明一个全局规则。

---

## 20. 自动隐藏实现的推荐策略矩阵

| 场景 | 隐藏 API | 活动检测 | timer | 推荐度 |
|---|---|---|---|---|
| 普通 Win32 播放器 client area | `WM_SETCURSOR + SetCursor(NULL)` | `WM_MOUSEMOVE` | `SetTimer` | ★★★★★ |
| 全屏 slideshow，有明确 enter/exit | balanced `ShowCursor` | 状态切换 | 可选 | ★★★★☆ |
| FPS / 3D relative mouse | 框架 cursor-null / `ShowCursor` | Raw Input | 通常不用 idle timer | ★★★★★ |
| WPF 播放器 | `Mouse.OverrideCursor=Cursors.None` | `MouseMove` | `DispatcherTimer` | ★★★★★ |
| WinForms | `Cursor.Hide/Show` | `MouseMove` | Forms Timer | ★★★★☆ |
| session 完全无用户输入 | 取决于 UI | `GetLastInputInfo` | 周期检查 | ★★★★☆ |
| hover N ms 后动作 | 任意 | `TrackMouseEvent` | 系统 hover timer | ★★★☆☆ |
| 跨进程强制整个桌面 cursor 消失 | 不建议 | 全局输入 | — | ★☆☆☆☆ |
| 改系统 cursor 为透明 | `SetSystemCursor` | — | — | 不建议 |

---

## 21. 推荐的生产级状态机

不要让“是否隐藏”只散落在多个事件处理函数中；把它做成一个明确状态。

建议状态：

```cpp
enum class CursorMode {
    Visible,
    AutoHideArmed,
    HiddenByIdle,
    HiddenByRelativeMode
};
```

关键事件：

```text
MouseActivity
IdleTimeout
EnterFullscreen
LeaveFullscreen
EnterRelativeMode
LeaveRelativeMode
Activate
Deactivate
MouseLeave
CaptureBegin
CaptureEnd
Destroy
```

典型规则：

```text
Deactivate           => Visible
Destroy              => Visible
MouseLeave           => Visible
CaptureBegin         => Visible / suspend idle hide
MouseActivity        => Visible + rearm timer
IdleTimeout          => HiddenByIdle, only if foreground + pointer in eligible area
EnterRelativeMode    => HiddenByRelativeMode, idle timer disabled
LeaveRelativeMode    => Visible
```

这样能够避免：

- 鼠标永远恢复不出来；
- 全屏退出后仍隐藏；
- Alt+Tab 后别的窗口看不到 cursor；
- idle timer 和游戏 relative mode 互相打架；
- 多次 Hide 导致 `ShowCursor` 计数失衡。

---

## 22. 常见 Bug 与根因

### Bug 1：`SetCursor(NULL)` 后一移动就出现

**原因**：class cursor / `DefWindowProc(WM_SETCURSOR)` 把它设置回来了。

**修复**：处理 `WM_SETCURSOR` 返回 `TRUE`，或 class cursor 设为 null 并自己负责 cursor。

---

### Bug 2：调用 `ShowCursor(TRUE)` 但还是看不到

**原因**：之前 Hide 次数多于 Show，显示计数仍然 `< 0`。

**修复**：把 Hide/Show 设计成成对状态切换；不要让多个组件无所有权地操作同一个计数。

---

### Bug 3：用户一直打字，播放器的 cursor 永远不隐藏

**原因**：错误使用 `GetLastInputInfo` 作为“鼠标不动”判断；键盘输入也算 last input。

**修复**：mouse-only idle 用 `WM_MOUSEMOVE` / Raw Input。

---

### Bug 4：鼠标已经移出应用，timer 仍然把 cursor 隐藏

**原因**：timer 到期时没重新验证作用域。

**修复**：隐藏前检查：

```text
foreground window == me
AND pointer is in my eligible client area
```

同时处理 `WM_MOUSELEAVE`。

---

### Bug 5：第一次移动 cursor 还是不出现，要再移动一下才出现

**原因**：`WM_SETCURSOR` 往往先于后续 mouse message 执行；如果该时刻状态还是 Hidden，系统先设置了 NULL，然后你只在 `WM_MOUSEMOVE` 中把 bool 改成 Visible，却没有马上 `SetCursor`。

**修复**：在检测到第一次 mouse activity 时显式恢复 cursor，而不是只改 bool。

---

### Bug 6：触摸以后 cursor 看不到，以为自己的 Hide 出错

**原因**：可能是 `CURSOR_SUPPRESSED`。

**修复**：用 `GetCursorInfo` 区分 show count hidden 与 touch/pen suppression。

---

### Bug 7：用 `TrackMouseEvent` 做 idle，轻微鼠标移动却仍触发

**原因**：hover 的定义是“保持在 hover rectangle 内”，并非坐标完全不变。

**修复**：严格 mouse movement idle 用 `WM_MOUSEMOVE` 重置 timer。

---

### Bug 8：用 `GetCursorPos` 判断 FPS 鼠标静止，结果一进游戏就一直隐藏

**原因**：relative mode 下 pointer 可能被固定在屏幕中心，真实物理移动不会反映成绝对坐标变化。

**修复**：使用 Raw Input delta。

---

## 23. 可观测性与调试建议

开发时建议做一个 cursor debug overlay / 日志：

```text
cursorHiddenByApp = true/false
cursorInfo.flags
cursorInfo.hCursor
cursorInfo.ptScreenPos
foregroundHwnd
windowUnderPointer
captureHwnd
lastMouseActivityTick
idleElapsedMs
showCursor operation count owned by app
current mode: normal / fullscreen / relative
```

### 23.1 `GetCursorInfo`

用于验证：

- 当前系统认为 cursor 是否 showing；
- 是否 suppressed；
- 当前 HCURSOR；
- pointer screen position。

### 23.2 WinEvent Hook

调试 cursor 被其他组件改掉时，可以监听：

```text
EVENT_OBJECT_SHOW
EVENT_OBJECT_HIDE
EVENT_OBJECT_NAMECHANGE
OBJID_CURSOR
```

不要把它作为普通自动隐藏主逻辑，只把它作为诊断工具。

### 23.3 记录每个 Hide/Show 的 owner

如果项目使用 `ShowCursor`，最好统一封装：

```cpp
CursorVisibilityToken HideCursorFor(CursorReason reason);
```

不要允许业务代码到处直接调用 `ShowCursor`。

否则非常容易出现：

```text
VideoControls Hide
GameMode Hide
ModalDialog Show
VideoControls Show
```

最终计数与真实业务状态完全脱节。

---

## 24. 测试矩阵

自动隐藏功能至少要覆盖：

### 窗口状态

- windowed
- maximized
- borderless fullscreen
- exclusive/relative input mode（若有）
- 多显示器
- DPI 100% / 150% / 200%

### 输入

- 普通 USB/Bluetooth mouse
- touchpad
- precision touchpad
- pen
- touch screen
- 鼠标滚轮
- 鼠标按键但无移动
- 键盘持续输入但鼠标不动

### 生命周期

- Alt+Tab
- Win 键打开 Start
- UAC / secure desktop 前后
- 锁屏/解锁
- RDP 登录/断开/重连
- Sleep / Resume
- 窗口被最小化
- 窗口销毁

### 交互

- 鼠标停在 client area
- 鼠标停在标题栏
- 鼠标停在 resize border
- 鼠标停在 child HWND
- 鼠标离开窗口
- mouse capture / drag 中 timer 到期
- cursor 已由控件变成 IBeam/Hand 时自动隐藏和恢复

重点验证：**任何失去应用控制权的路径都不能留下“鼠标仍被本应用隐藏”的状态。**

---

## 25. API 总表

| API / 消息 | 作用 | 是否直接隐藏 | 作用域/关键点 |
|---|---|---:|---|
| `ShowCursor` | 修改 cursor show count | 是 | Win32 下与 thread/input queue 相关；必须平衡 |
| `SetCursor(NULL)` | 当前 cursor image 置空 | 是 | 后续 `WM_SETCURSOR` 可能覆盖 |
| `WM_SETCURSOR` | 窗口决定当前 cursor | 间接 | 本窗口/child cursor 控制的核心 |
| `SetClassLongPtr(...GCLP_HCURSOR...)` | 改 window class cursor | 间接 | class 级，不是单 HWND |
| `GetCursorInfo` | 查询 global cursor 信息 | 否 | 可区分 hidden / showing / suppressed |
| `GetCursor` | 当前线程 cursor handle | 否 | 非全局；全局信息应看 `GetCursorInfo` |
| `SystemParametersInfo(SPI_GET/SETMOUSEVANISH)` | 打字时 cursor vanish 设置 | 是（系统功能） | 不是 idle N 秒 |
| `TrackMouseEvent` | hover / leave tracking | 否 | hover rectangle + timeout |
| `SetTimer` / `WM_TIMER` | UI timer | 否 | 适合 idle auto-hide；WM_TIMER 低优先级 |
| `RegisterRawInputDevices` / `WM_INPUT` | 原始设备输入 | 否 | relative/high precision/background |
| `GetLastInputInfo` | session last input | 否 | 键鼠等输入，非 mouse-only；session-specific |
| `SetSystemCursor` | 替换系统 cursor | 可间接“透明” | 不推荐用于普通应用隐藏 |
| `SPI_SETCURSORS` | 重新加载系统 cursors | 否 | 可用于恢复系统 cursor scheme |
| `SetWinEventHook` | 监听 cursor show/hide/change | 否 | 诊断/辅助功能/自动化用途 |
| WPF `Cursors.None` | 不可见 cursor | 是 | WPF 元素/应用 scope |
| WinForms `Cursor.Hide/Show` | 框架封装 | 是 | 必须平衡 |
| UWP `CoreWindow.PointerCursor=null` | 隐藏 app pointer | 是 | relative mouse 官方方案 |
| WinUI `InputPointerSource.Cursor` | 指定 input target cursor | 间接 | Windows App SDK |

---

## 26. 最终工程建议

如果要在一个 Windows 桌面软件中实现：

> “鼠标在播放器/画布区域 3 秒不动就隐藏，一动就出现”

推荐实现优先级：

### Win32

```text
WM_MOUSEMOVE
  -> Show local cursor immediately
  -> record lastMouseActivity
  -> SetTimer(..., 3000)

WM_TIMER
  -> verify foreground
  -> verify pointer still inside eligible client area
  -> Hide with SetCursor(NULL)

WM_SETCURSOR
  -> if hidden + HTCLIENT: SetCursor(NULL), return TRUE
  -> else set correct visible cursor, return TRUE

WM_MOUSELEAVE / WM_ACTIVATEAPP(false) / exit fullscreen / destroy
  -> always restore cursor
```

### WPF

```text
MouseMove -> Mouse.OverrideCursor = null; restart DispatcherTimer
Timer -> Mouse.OverrideCursor = Cursors.None
Deactivate/Close -> Mouse.OverrideCursor = null
```

### WinForms

```text
MouseMove -> balanced Cursor.Show(); restart Timer
Timer -> Cursor.Hide()
Deactivate/Close -> ensure matching Cursor.Show()
```

### 3D / Game

```text
Relative mode ON
  -> Raw Input / framework relative mouse
  -> hide cursor for entire mode

Relative mode OFF
  -> restore normal absolute pointer
```

### 不推荐

```text
全局 WH_MOUSE_LL + 强行控制 cursor
SetSystemCursor(transparent)
频繁轮询 GetCursorPos
无状态地多处 ShowCursor(FALSE/TRUE)
把 GetLastInputInfo 当 mouse-only inactivity
```

---

## 27. 一句话结论

**Windows 的 cursor 隐藏本质上是“输入队列中的 cursor 显示状态 + 当前 cursor handle + WM_SETCURSOR 默认选择逻辑”的组合；系统原生只有“打字时隐藏”的 Mouse Vanish，而“鼠标静止 N 秒自动隐藏”应该由应用通过鼠标活动事件和 timer 自己实现。对于普通 Win32 软件，最可控的方案是 `WM_MOUSEMOVE + SetTimer + WM_SETCURSOR + SetCursor(NULL)`，而不是把 `ShowCursor` 当成简单的全局 Visible 开关。**

---

# 参考资料

> 以下优先使用 Microsoft Learn 和 Microsoft 官方 Windows 工程博客。

1. Microsoft Learn — ShowCursor function  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showcursor

2. Microsoft Learn — SetCursor function  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursor

3. Microsoft Learn — WM_SETCURSOR message  
   https://learn.microsoft.com/en-us/windows/win32/menurc/wm-setcursor

4. Microsoft Learn — GetCursorInfo function  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorinfo

5. Microsoft Learn — CURSORINFO structure  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-cursorinfo

6. Microsoft Learn — SetClassLongPtrW / GCLP_HCURSOR  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclasslongptrw

7. Microsoft Learn — Raw Input Overview  
   https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input

8. Microsoft Learn — RAWINPUTDEVICE / RIDEV_INPUTSINK  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice

9. Microsoft Learn — SystemParametersInfo / SPI_GETMOUSEVANISH / SPI_SETMOUSEVANISH / SPI_SETCURSORS  
   https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow

10. Microsoft Learn — Mouse Input Overview / Mouse Vanish  
    https://learn.microsoft.com/en-us/windows/win32/inputdev/about-mouse-input

11. Microsoft Learn — SetTimer  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-settimer

12. Microsoft Learn — WM_TIMER  
    https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-timer

13. Microsoft Learn — GetLastInputInfo  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo

14. Raymond Chen, The Old New Thing — What was the ShowCursor function intended to be used for?  
    https://devblogs.microsoft.com/oldnewthing/20091217-00/?p=15643

15. Raymond Chen, The Old New Thing — When I define a window class with no default cursor, what is the explanation for the cursors that appear in my client area?  
    https://devblogs.microsoft.com/oldnewthing/20250424-00/?p=111114

16. Microsoft Learn — Windows Forms Cursor.Hide / Cursor.Show  
    https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.cursor.hide?view=windowsdesktop-10.0

17. Microsoft Learn — TrackMouseEvent / TRACKMOUSEEVENT  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-trackmouseevent  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-trackmouseevent

18. Microsoft Learn — SetSystemCursor  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setsystemcursor

19. Microsoft Learn — SystemParametersInfo / SPI_SETCURSORS  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow

20. Microsoft Learn — SetWinEventHook / Object Identifiers / Event Constants  
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook  
    https://learn.microsoft.com/en-us/windows/win32/winauto/object-identifiers  
    https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants

21. Microsoft Learn — WPF Cursors.None / Mouse.OverrideCursor  
    https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.cursors.none?view=windowsdesktop-10.0  
    https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.mouse.overridecursor?view=windowsdesktop-10.0

22. Microsoft Learn — UWP Relative mouse movement / CoreWindow.PointerCursor  
    https://learn.microsoft.com/en-us/windows/uwp/gaming/relative-mouse-movement  
    https://learn.microsoft.com/en-us/uwp/api/windows.ui.core.corewindow.pointercursor

23. Microsoft Learn — Windows App SDK InputPointerSource.Cursor  
    https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.input.inputpointersource.cursor

24. Raymond Chen, The Old New Thing — How can I get notified when the cursor changes?  
    https://devblogs.microsoft.com/oldnewthing/20151116-00/?p=92091

25. Microsoft Learn — WM_INPUT  
    https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-input

---

## 附：进一步研究方向

如果需要继续下钻，可以进一步做三类专项研究：

1. **Chromium / VLC / mpv / SDL / Qt 在 Windows 上的 cursor auto-hide 实际源码对比**：分析成熟跨平台软件如何处理 idle timer、child HWND、fullscreen、relative input。
2. **Windows 内部输入队列/USER32/win32k cursor 状态链路**：从 thread input queue、`WM_SETCURSOR`、win32k 到 compositor/hardware cursor plane 的更底层分析。
3. **录屏/远程桌面场景**：DXGI Desktop Duplication、Windows Graphics Capture、RDP 中 cursor shape/position 与 cursor visibility 的独立传输机制。
