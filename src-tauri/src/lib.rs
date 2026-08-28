#[cfg(windows)]
mod screensaver {
    use std::fs;
    use std::path::PathBuf;
    use winreg::enums::*;
    use winreg::RegKey;

    const SCR_NAME: &str = "FlipClock.scr";

    /// 获取 .scr 文件路径(放在当前 exe 同级目录)
    fn get_scr_path() -> Result<PathBuf, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = exe.parent().ok_or("无法获取 exe 目录")?;
        Ok(dir.join(SCR_NAME))
    }

    /// 注册屏保:复制 exe 为 .scr,写入注册表
    pub fn register() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {e}"))?;
        let scr_path = get_scr_path()?;

        // 复制 exe → .scr(Windows 屏保本质就是改后缀的 exe)
        fs::copy(&exe, &scr_path).map_err(|e| {
            if e.raw_os_error() == Some(5) {
                format!(
                    "复制屏保文件失败: 拒绝访问。程序安装目录(可能是 Program Files)无写权限,\n\
                     请以管理员身份运行,或重新安装到用户可写目录。 (原始错误: {e})"
                )
            } else {
                format!("复制屏保文件失败: {e}")
            }
        })?;

        let scr_str = scr_path.to_string_lossy().to_string();

        // 写入注册表:HKCU\Control Panel\Desktop
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = hkcu
            .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE)
            .map_err(|e| format!("打开注册表失败: {e}"))?;

        // 写入 SCRNSAVE.EXE(屏保程序路径)
        if let Err(e) = desktop.set_value("SCRNSAVE.EXE", &scr_str) {
            // 诊断:写 SCRNSAVE.EXE 失败时,尝试写一个测试值,区分根因
            //   - 测试值可写     → 仅 SCRNSAVE.EXE 被保护(GPO / 安全软件)
            //   - 测试值也不可写 → 整个子键无写权限(目录/权限问题)
            let test_ok = desktop.set_value("FlipClockTest", &"1").is_ok();
            let _ = desktop.delete_value("FlipClockTest"); // 清理测试值
            let hint = if test_ok {
                concat!(
                    "写入屏保注册表被拒绝:SCRNSAVE.EXE 值受系统保护,但其他注册表项可正常写入。\n",
                    "可能原因:\n",
                    "1) 企业域组策略(GPO)锁定了屏保设置,请联系 IT 管理员;\n",
                    "2) 杀毒软件/安全软件拦截了对屏保注册表的修改,请临时关闭后重试。\n",
                    "可手动将本软件安装目录下的 FlipClock.scr 文件复制到 ",
                    r"C:\Windows\System32",
                    " 目录并在「设置 → 个性化 → 锁屏界面 → 屏幕保护程序」中选择 Flip Clock。"
                )
            } else {
                concat!(
                    "写入注册表被拒绝:当前用户对该注册表项无写权限。\n",
                    "可能原因:\n",
                    "1) 程序安装在被保护目录,请以管理员身份运行;\n",
                    "2) 系统策略限制了注册表写入。"
                )
            };
            return Err(format!("{hint} (原始错误: {e})"));
        }

        desktop
            .set_value("ScreenSaveActive", &"1")
            .map_err(|e| format!("写入 ScreenSaveActive 失败: {e}"))?;

        Ok(scr_str)
    }

    /// 注销屏保:删除注册表项
    pub fn unregister() -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = hkcu
            .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE)
            .map_err(|e| format!("打开注册表失败: {e}"))?;

        // 删除 SCRNSAVE.EXE 值即可禁用屏保
        let _ = desktop.delete_value("SCRNSAVE.EXE");

        Ok(())
    }

    /// 检查屏保是否已注册
    pub fn is_registered() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = match hkcu.open_subkey_with_flags("Control Panel\\Desktop", KEY_READ) {
            Ok(k) => k,
            Err(_) => return false,
        };
        let val: Option<String> = desktop.get_value("SCRNSAVE.EXE").ok();
        val
            .map(|v| v.ends_with(SCR_NAME))
            .unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod screensaver {
    pub fn register() -> Result<String, String> {
        Err("屏保功能仅支持 Windows".to_string())
    }
    pub fn unregister() -> Result<(), String> {
        Err("屏保功能仅支持 Windows".to_string())
    }
    pub fn is_registered() -> bool {
        false
    }
}

#[tauri::command]
fn register_screensaver() -> Result<String, String> {
    screensaver::register()
}

#[tauri::command]
fn unregister_screensaver() -> Result<(), String> {
    screensaver::unregister()
}

#[tauri::command]
fn is_screensaver_registered() -> bool {
    screensaver::is_registered()
}

/// Windows 屏保超时时间(秒)
/// 使用 SystemParametersInfoW(SPI_GETSCREENSAVETIMEOUT / SPI_SETSCREENSAVETIMEOUT)
/// 参考: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow
#[cfg(windows)]
mod win_api {
    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(
            ui_action: u32,
            ui_param: u32,
            pv_param: *mut std::ffi::c_void,
            f_win_ini: u32,
        ) -> i32;
    }

    const SPI_GETSCREENSAVETIMEOUT: u32 = 0x000E;
    const SPI_SETSCREENSAVETIMEOUT: u32 = 0x000F;
    const SPIF_UPDATEINIFILE: u32 = 0x01;

    pub fn get_timeout() -> Result<u32, String> {
        let mut value: u32 = 0;
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_GETSCREENSAVETIMEOUT,
                0,
                &mut value as *mut u32 as *mut _,
                0,
            )
        };
        if ok == 0 {
            Err("获取屏保超时失败".to_string())
        } else {
            Ok(value)
        }
    }

    pub fn set_timeout(seconds: u32) -> Result<(), String> {
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_SETSCREENSAVETIMEOUT,
                seconds,
                std::ptr::null_mut(),
                SPIF_UPDATEINIFILE,
            )
        };
        if ok == 0 {
            Err("设置屏保超时失败".to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod win_api {
    pub fn get_timeout() -> Result<u32, String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn set_timeout(_seconds: u32) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
}

#[tauri::command]
fn get_screensaver_timeout() -> Result<u32, String> {
    win_api::get_timeout()
}

#[tauri::command]
fn set_screensaver_timeout(seconds: u32) -> Result<(), String> {
    win_api::set_timeout(seconds)
}

/// 退出屏保:任意窗口检测到输入即调用,退出整个进程(一次性关闭所有显示器上的窗口)
#[tauri::command]
fn exit_saver(app: tauri::AppHandle) {
    app.exit(0);
}

/// 用户点击右上角 X 主动退出:关闭所有显示器上的窗口。
/// 不复用 CloseRequested 事件——reconcile 清理阶段(取消勾选/拔显示器)也
/// 会触发窗口关闭事件,那里只应关掉单个窗口,绝不能退出整个进程。
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ==================== 显示器枚举与持久身份 ====================
// 身份策略(参考多显示器研究报告):
//  - 运行时坐标(x/y/w/h)每次现查,绝不持久化 → 分辨率/主屏切换/DPI 变化天然免疫
//  - 持久 ID 用 QueryDisplayConfig 的 monitorDevicePath(含显示器型号与实例路径)
//    HMONITOR / \\.\DISPLAYn 会随插拔、主屏切换、驱动变化而变,不能跨会话复用
//  - EnumDisplayMonitors(物理矩形) 与 QueryDisplayConfig(身份) 通过
//    MONITORINFOEXW.szDevice ↔ DISPLAYCONFIG_SOURCE_NAME.viewGdiDeviceName 关联

/// 显示器信息(物理坐标,可直接配合 SetWindowPos 精确定位)
#[cfg(windows)]
mod monitors {
    use serde::Serialize;
    use std::collections::HashMap;

    #[derive(Clone, Serialize)]
    pub struct MonitorInfo {
        /// 持久身份(QueryDisplayConfig monitorDevicePath;查询失败时退化为 \\.\DISPLAYn)
        pub id: String,
        /// 友好名称(如 "DELL U2720Q")
        pub name: String,
        pub is_primary: bool,
        pub x: i32,
        pub y: i32,
        pub width: i32,
        pub height: i32,
    }

    // ===== Win32 FFI =====
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfoExW {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        flags: u32,
        sz_device: [u16; 32],
    }

    type MonitorEnumProc = unsafe extern "system" fn(
        hmonitor: *mut std::ffi::c_void,
        hdc: *mut std::ffi::c_void,
        lprc: *mut Rect,
        lparam: isize,
    ) -> i32;

    /// EnumDisplayDevices 设备结构(纯定长数组,无对齐陷阱;sizeof = 840)
    #[repr(C)]
    struct DisplayDeviceW {
        cb: u32,
        device_name: [u16; 32],
        device_string: [u16; 128],
        state_flags: u32,
        device_id: [u16; 128],
        device_key: [u16; 128],
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumDisplayMonitors(
            hdc: *mut std::ffi::c_void,
            lprc_clip: *const Rect,
            lpfn_enum: MonitorEnumProc,
            dw_data: isize,
        ) -> i32;
        fn GetMonitorInfoW(hmonitor: *mut std::ffi::c_void, lpmi: *mut MonitorInfoExW) -> i32;
        fn EnumDisplayDevicesW(
            lpdevice: *const u16,
            idevnum: u32,
            lpdisplaydevice: *mut DisplayDeviceW,
            dwflags: u32,
        ) -> i32;
    }

    const MONITORINFOF_PRIMARY: u32 = 1;
    const DISPLAY_DEVICE_ACTIVE: u32 = 0x0000_0008;

    struct RawMonitor {
        device: String,
        is_primary: bool,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    }

    fn from_utf16(buf: &[u16]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    }

    unsafe extern "system" fn enum_proc(
        hmonitor: *mut std::ffi::c_void,
        _hdc: *mut std::ffi::c_void,
        _lprc: *mut Rect,
        lparam: isize,
    ) -> i32 {
        let mut mi: MonitorInfoExW = std::mem::zeroed();
        mi.cb_size = std::mem::size_of::<MonitorInfoExW>() as u32;
        if GetMonitorInfoW(hmonitor, &mut mi) != 0 {
            let vec = &mut *(lparam as *mut Vec<RawMonitor>);
            vec.push(RawMonitor {
                device: from_utf16(&mi.sz_device),
                is_primary: mi.flags & MONITORINFOF_PRIMARY != 0,
                x: mi.rc_monitor.left,
                y: mi.rc_monitor.top,
                width: mi.rc_monitor.right - mi.rc_monitor.left,
                height: mi.rc_monitor.bottom - mi.rc_monitor.top,
            });
        }
        1 // 继续枚举
    }

    /// 查询显示器持久身份:EnumDisplayDevices 两级枚举。
    ///  - 一级:显示设备(DeviceName = \\.\DISPLAYn,与 EnumDisplayMonitors 的
    ///    szDevice 同一命名空间,直接作关联 key)
    ///  - 二级:该显示设备挂接的显示器(DeviceID = MONITOR\厂商码\实例路径,
    ///    基于 EDID 的稳定硬件身份,可跨会话复用;DeviceString = 显示器型号)
    ///
    /// 历史教训:曾用 QueryDisplayConfig + DisplayConfigGetDeviceInfo 实现此功能,
    /// 其结构体含 union/LUID,手写 FFI 极易布局错位;实际运行中该路径反复出现
    /// 堆损坏型随机崩溃(同类操作时崩时不崩、无 panic 无崩溃码),整体移除。
    /// EnumDisplayDevices 的 DISPLAY_DEVICEW 为纯定长数组,无对齐陷阱。
    /// 查询失败返回空表,调用方退化为 \\.\DISPLAYn 作 ID(功能可用,仅跨会话识别变弱)。
    fn query_identity() -> HashMap<String, (String, String)> {
        let mut map = HashMap::new();
        let mut i: u32 = 0;
        unsafe {
            loop {
                let mut dd: DisplayDeviceW = std::mem::zeroed();
                dd.cb = std::mem::size_of::<DisplayDeviceW>() as u32;
                if EnumDisplayDevicesW(std::ptr::null(), i, &mut dd, 0) == 0 {
                    break; // 枚举完毕
                }
                i += 1;
                if dd.state_flags & DISPLAY_DEVICE_ACTIVE == 0 {
                    continue; // 非活动显示设备
                }
                let src = from_utf16(&dd.device_name); // \\.\DISPLAY1
                let src_wide: Vec<u16> = src.encode_utf16().chain(std::iter::once(0)).collect();
                // 二级:取该显示设备的显示器信息
                let mut md: DisplayDeviceW = std::mem::zeroed();
                md.cb = std::mem::size_of::<DisplayDeviceW>() as u32;
                if EnumDisplayDevicesW(src_wide.as_ptr(), 0, &mut md, 0) != 0 {
                    let id = from_utf16(&md.device_id); // MONITOR\DEL40A9\5&...
                    if !id.is_empty() {
                        map.insert(src, (id, from_utf16(&md.device_string)));
                    }
                }
            }
        }
        map
    }

    /// 枚举所有显示器(物理坐标 + 持久身份)。
    /// 返回 None 表示枚举失败,调用方必须直接中止(绝不能据此关闭任何窗口)。
    pub fn enumerate() -> Option<Vec<MonitorInfo>> {
        let mut raw: Vec<RawMonitor> = Vec::new();
        unsafe {
            if EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                enum_proc,
                &mut raw as *mut Vec<RawMonitor> as isize,
            ) == 0
            {
                return None;
            }
        }
        if raw.is_empty() {
            return None;
        }
        let identity = query_identity();
        let mut list = Vec::with_capacity(raw.len());
        for (i, m) in raw.iter().enumerate() {
            let fallback_name = format!("显示器 {}", i + 1);
            let (id, name) = match identity.get(&m.device) {
                Some((path, friendly)) => {
                    let name = if friendly.trim().is_empty() {
                        fallback_name
                    } else {
                        friendly.clone()
                    };
                    (path.clone(), name)
                }
                None => (m.device.clone(), fallback_name),
            };
            list.push(MonitorInfo {
                id,
                name,
                is_primary: m.is_primary,
                x: m.x,
                y: m.y,
                width: m.width,
                height: m.height,
            });
        }
        Some(list)
    }
}

/// 非 Windows 桩:单显示器,保证整体流程可编译运行
#[cfg(not(windows))]
mod monitors {
    use serde::Serialize;

    #[derive(Clone, Serialize)]
    pub struct MonitorInfo {
        pub id: String,
        pub name: String,
        pub is_primary: bool,
        pub x: i32,
        pub y: i32,
        pub width: i32,
        pub height: i32,
    }

    pub fn enumerate() -> Option<Vec<MonitorInfo>> {
        Some(vec![MonitorInfo {
            id: "primary".to_string(),
            name: "主显示器".to_string(),
            is_primary: true,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }])
    }
}

// ==================== 显示位置设置持久化 ====================
// 存 Rust 侧文件而非前端 localStorage:窗口在 setup 阶段创建时 WebView 尚未启动,
// 读不到 localStorage;settings.json 可在创建窗口前直接读取。
// 只存显示器持久 ID,绝不存坐标(坐标每次现查,免疫分辨率/DPI/主屏切换)。
mod app_settings {
    use serde::{Deserialize, Serialize};
    use std::path::PathBuf;

    #[derive(Default, Serialize, Deserialize)]
    struct Settings {
        /// 选中的显示器持久 ID 列表;空/缺省 = 未配置(默认主屏)。
        /// 保留已断开的显示器 ID,重连后自动恢复显示(docking 体验)。
        selected_monitors: Option<Vec<String>>,
    }

    fn settings_dir() -> PathBuf {
        let base = std::env::var("APPDATA")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(base).join("com.flipclock.app")
    }

    pub fn load_selected() -> Vec<String> {
        let path = settings_dir().join("settings.json");
        let Ok(raw) = std::fs::read_to_string(path) else {
            return vec![];
        };
        serde_json::from_str::<Settings>(&raw)
            .ok()
            .and_then(|s| s.selected_monitors)
            .unwrap_or_default()
    }

    pub fn save_selected(ids: &[String]) {
        let dir = settings_dir();
        let _ = std::fs::create_dir_all(&dir);
        let settings = Settings {
            selected_monitors: Some(ids.to_vec()),
        };
        if let Ok(json) = serde_json::to_string_pretty(&settings) {
            let _ = std::fs::write(dir.join("settings.json"), json);
        }
    }
}

/// 共享 WebView2 用户数据目录:app.exe 和 FlipClock.scr 使用同一缓存,
/// 多窗口也共享同一环境(GPU 着色器缓存互通)
#[cfg(windows)]
fn webview_data_dir() -> std::path::PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(local)
        .join("com.flipclock.app")
        .join("webview-data")
}

// ==================== 诊断日志 ====================
// 写入 exe 同级目录(安装文件夹)flipclock.log;目录不可写(Program Files 等)时
// 回退 %APPDATA%\com.flipclock.app\。失败静默——诊断用途,绝不影响功能。
//
// 格式:[本地时间.毫秒] [线程标记] 消息
//  - MAIN = Tauri 主线程(事件循环所在);tXXXX = 其他线程
//  - 卡死定位方法:找到"最后一条 MAIN 日志",它就是主线程卡住的位置;
//    后台线程若也停在某条 step 日志,即互等死锁的另一半。
mod logging {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    /// 主线程 ID(run() 入口记录),用于日志标记
    static MAIN_THREAD: Mutex<Option<std::thread::ThreadId>> = Mutex::new(None);
    /// 序列号:同一毫秒内多条日志仍可排序
    static SEQ: AtomicU64 = AtomicU64::new(0);
    static WRITE_LOCK: Mutex<()> = Mutex::new(());

    fn log_path() -> std::path::PathBuf {
        // 优先 exe 同级目录(安装文件夹)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                // 探测可写性:尝试以追加模式打开
                let probe = dir.join("flipclock.log");
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&probe)
                {
                    let _ = write!(f, "");
                    return probe;
                }
            }
        }
        // 回退:APPDATA(开发模式 / 只读安装目录)
        let base = std::env::var("APPDATA")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        let dir = std::path::PathBuf::from(base).join("com.flipclock.app");
        let _ = std::fs::create_dir_all(&dir);
        dir.join("flipclock.log")
    }

    fn now_hms() -> String {
        // 本地时间 HH:MM:SS.mmm(仅诊断显示,不涉及时区计算)
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = d.as_secs() as i64;
        let ms = d.subsec_millis();
        // UTC+8(用户时区);仅用于肉眼阅读,误差无关紧要
        let local = secs + 8 * 3600;
        let h = (local / 3600) % 24;
        let m = (local / 60) % 60;
        let s = local % 60;
        format!("{h:02}:{m:02}:{s:02}.{ms:03}")
    }

    pub fn write(msg: &str) {
        let tid = std::thread::current().id();
        let main = MAIN_THREAD.lock().unwrap_or_else(|e| e.into_inner());
        let tag = if *main == Some(tid) {
            "MAIN".to_string()
        } else {
            format!("{:?}", tid) // "ThreadId(3)" 形式
        };
        drop(main);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let line = format!("[{} #{seq:04}] [{}] {}", now_hms(), tag, msg);

        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = log_path();
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(f, "{line}");
        }
    }

    /// 记录当前线程为主线程(run 入口调用一次)
    pub fn mark_main_thread() {
        *MAIN_THREAD.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::thread::current().id());
    }
}

pub(crate) fn app_log(msg: &str) {
    logging::write(msg);
}

// ==================== 原生崩溃捕获 ====================
// SetUnhandledExceptionFilter:访问违例/栈溢出/堆损坏等硬崩溃不走 Rust panic
// 机制,此前这类闪退在日志中表现为"戛然而止、毫无痕迹"。装上过滤器后,
// 进程咽气前会挣扎着写一条 NATIVE-CRASH 日志(异常码 + 地址)。
#[cfg(windows)]
mod crash_handler {
    use std::io::Write;

    const EXCEPTION_CONTINUE_SEARCH: i32 = 0; // 交回系统默认处理,保留正常崩溃行为

    #[repr(C)]
    struct ExceptionRecord {
        exception_code: u32,
        exception_flags: u32,
        exception_record: *mut ExceptionRecord,
        exception_address: *mut std::ffi::c_void,
        number_parameters: u32,
        exception_information: [usize; 15],
    }

    #[repr(C)]
    struct ExceptionPointers {
        exception_record: *mut ExceptionRecord,
        context_record: *mut std::ffi::c_void, // PCONTEXT,不解引用,仅占位
    }

    type ExceptionFilterFn = unsafe extern "system" fn(*mut ExceptionPointers) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetUnhandledExceptionFilter(filter: Option<ExceptionFilterFn>) -> *mut std::ffi::c_void;
    }

    fn name_of(code: u32) -> &'static str {
        match code {
            0xC0000005 => "ACCESS_VIOLATION 读写非法内存",
            0xC00000FD => "STACK_OVERFLOW 栈溢出",
            0xC0000374 => "HEAP_CORRUPTION 堆损坏",
            0xC0000409 => "FASTFAIL 栈缓冲区越界",
            0xC0000135 => "DLL_NOT_FOUND",
            0xC0000142 => "DLL_INIT_FAILED",
            0x80000003 => "BREAKPOINT",
            _ => "其他",
        }
    }

    unsafe extern "system" fn on_crash(ep: *mut ExceptionPointers) -> i32 {
        // 崩溃现场原则:只做最少的事(拼短消息 + 直写文件),不碰锁/不遍历/不格式化复杂结构
        let (code, addr) = if ep.is_null() || (*ep).exception_record.is_null() {
            (0u32, 0usize)
        } else {
            let rec = &*(*ep).exception_record;
            (rec.exception_code, rec.exception_address as usize)
        };
        let msg = format!(
            "NATIVE-CRASH: exception={code:#010X}({}) address={addr:#X}\n",
            name_of(code)
        );
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(dir.join("flipclock.log"))
                {
                    let _ = f.write_all(msg.as_bytes());
                }
            }
        }
        EXCEPTION_CONTINUE_SEARCH
    }

    pub fn install() {
        unsafe {
            SetUnhandledExceptionFilter(Some(on_crash));
        }
    }
}

#[cfg(not(windows))]
mod crash_handler {
    pub fn install() {}
}

// ==================== 普通模式窗口管理(reconcile 收敛) ====================
// 线程模型(多轮崩溃排查后的最终结论):
//  - build() 绝不能在主线程上下文同步执行(Windows 上与 WebView2 初始化
//    互相等待 → 死锁,wry#583 / Tauri 官方文档明确警告)。
//  - 运行时(设置变更 / 显示器热插拔)统一经 tauri::async_runtime::spawn
//    派发执行——这是社区验证可靠的唯一运行时模式;直接在 async 命令体内
//    或裸 std::thread 中调用都出过冻结/崩溃。
//  - 启动路径(setup 回调,事件循环启动前)在主线程同步执行是安全的。
//  - 绝不在运行时对"已存在的全屏窗口"做 set_fullscreen/set_position 等状态
//    切换(曾导致主线程与后台线程在窗口内部状态上互等,整进程卡死)。
//    显示器几何变化一律"关旧建新",由记账快照判定,天然防循环。
mod window_manager {
    use crate::app_settings;
    use crate::monitors::MonitorInfo;
    use std::collections::HashMap;
    use std::panic::{self, AssertUnwindSafe};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Mutex, PoisonError};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    const NORMAL_PREFIX: &str = "normal-";
    static WINDOW_SEQ: AtomicU32 = AtomicU32::new(0);
    /// 防重入:并发触发直接跳过,等待下一轮事件补齐
    static BUSY: AtomicBool = AtomicBool::new(false);

    /// 记账:显示器 ID → (窗口 label, 建窗时显示器矩形快照)。
    /// 身份识别只认记账,绝不依赖窗口几何(全屏窗口矩形存在系统性偏差,
    /// 曾因此每轮误判"漂移"引发关窗/建窗死循环)。
    /// 快照比较的是"显示器矩形 vs 显示器矩形":只有真实分辨率/位置变化
    /// (虚拟屏幕重排)才会触发重建,重建后快照更新 → 不可能自激循环。
    struct Assignment {
        label: String,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    }
    static ASSIGNMENTS: Mutex<Option<HashMap<String, Assignment>>> = Mutex::new(None);

    #[derive(Clone, serde::Serialize)]
    pub struct MonitorStateDto {
        pub monitors: Vec<MonitorInfo>,
        pub selected: Vec<String>,
    }

    fn next_label() -> String {
        // label 只增不复用,避免与尚未销毁的旧窗口冲突
        format!("{}{}", NORMAL_PREFIX, WINDOW_SEQ.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn take_map() -> HashMap<String, Assignment> {
        ASSIGNMENTS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .unwrap_or_default()
    }

    fn store_map(m: HashMap<String, Assignment>) {
        *ASSIGNMENTS.lock().unwrap_or_else(PoisonError::into_inner) = Some(m);
    }

    fn has_normal_window(app: &AppHandle) -> bool {
        app.webview_windows()
            .values()
            .any(|w| w.label().starts_with(NORMAL_PREFIX))
    }

    fn assignment_of(mon: &MonitorInfo, label: String) -> Assignment {
        Assignment {
            label,
            x: mon.x,
            y: mon.y,
            w: mon.width,
            h: mon.height,
        }
    }

    /// 创建普通模式窗口:隐藏创建 → 物理坐标定位 → 进全屏 → show。
    /// 与启动路径完全同构;fullscreen 只做一次性进入,
    /// 绝不做"已存在全屏窗口"的全屏状态切换(死锁来源,见模块注释)。
    fn build_window(app: &AppHandle, label: &str, mon: &MonitorInfo) -> tauri::Result<WebviewWindow> {
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            label,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Flip Clock · 翻页时钟")
        .decorations(false)
        .resizable(true)
        .visible(false)
        .inner_size(800.0, 600.0)
        .background_color(tauri::webview::Color(10, 10, 15, 255));

        #[cfg(windows)]
        {
            builder = builder.data_directory(crate::webview_data_dir());
        }

        let window = builder.build()?;
        // 物理坐标定位不受 DPI 缩放影响,混合 DPI 下也能精准落位
        window.set_position(tauri::PhysicalPosition::new(mon.x, mon.y))?;
        window.set_size(tauri::PhysicalSize::new(mon.width as u32, mon.height as u32))?;
        window.set_fullscreen(true)?;
        window.show()?;
        Ok(window)
    }

    /// 窗口收敛:让"选中且在线"的每台显示器恰好有一个全屏窗口。
    /// 幂等,可由 启动 / 设置变更 / 显示器拓扑变化 任意触发。
    ///
    /// 不变量(任何路径不得违反):
    /// 1. 枚举失败 → 不动任何窗口,返回"当前是否有窗口"
    /// 2. targets 永不为空(选中全失效回退主屏)
    /// 3. 先建后关;创建失败保留旧窗;清理阶段新账为空则跳过关闭(全关即退出)
    /// 4. 只操作 normal- 前缀窗口,屏保窗口不受影响
    ///
    /// 返回收敛后是否仍有普通窗口存在(启动路径用于决定是否走兜底)。
    pub fn reconcile(app: &AppHandle) -> bool {
        if BUSY.swap(true, Ordering::SeqCst) {
            return has_normal_window(app); // 已有一轮在跑:跳过本次
        }
        // 捕获 panic:记账锁可能中毒(用 into_inner 容忍),BUSY 必须复位,
        // 且单次故障绝不拖垮整个进程
        let r = panic::catch_unwind(AssertUnwindSafe(|| reconcile_inner(app)));
        BUSY.store(false, Ordering::SeqCst);
        match r {
            Ok(v) => v,
            Err(_) => {
                crate::app_log("reconcile: PANIC (recovered)");
                has_normal_window(app)
            }
        }
    }

    fn reconcile_inner(app: &AppHandle) -> bool {
        let Some(monitors) = crate::monitors::enumerate() else {
            crate::app_log("reconcile: enumerate failed, keep windows as-is");
            return has_normal_window(app); // 不变量 1
        };
        let selected = app_settings::load_selected();

        // targets = 选中 ∩ 在线;为空回退主屏(再兜底第一块) → 不变量 2
        let mut targets: Vec<MonitorInfo> = monitors
            .iter()
            .filter(|m| selected.contains(&m.id))
            .cloned()
            .collect();
        if targets.is_empty() {
            let fallback = monitors
                .iter()
                .find(|m| m.is_primary)
                .or_else(|| monitors.first());
            if let Some(m) = fallback {
                targets.push(m.clone());
            }
        }

        let mut old = take_map();
        let mut next: HashMap<String, Assignment> = HashMap::new();

        for mon in &targets {
            let entry = old.remove(&mon.id);
            let window_alive = entry
                .as_ref()
                .is_some_and(|a| app.get_webview_window(&a.label).is_some());
            let geo_same = entry
                .as_ref()
                .is_some_and(|a| a.x == mon.x && a.y == mon.y && a.w == mon.width && a.h == mon.height);

            if window_alive && geo_same {
                // 一切正常:原样保留,完全不触碰窗口
                if let Some(a) = entry {
                    next.insert(mon.id.clone(), a);
                }
                continue;
            }
            // 需要新建:新勾选 / 显示器重连 / 窗口被外部关闭 / 显示器几何变化(关旧建新)
            match build_window(app, &next_label(), mon) {
                Ok(w) => {
                    next.insert(mon.id.clone(), assignment_of(mon, w.label().to_string()));
                }
                Err(e) => {
                    crate::app_log(&format!("reconcile: build failed for {}: {e}", mon.name));
                    // 建失败:保留旧窗记账(若有),下轮重试 → 不变量 3
                    if let Some(a) = entry {
                        next.insert(mon.id.clone(), a);
                    }
                }
            }
        }

        // 清理:关闭所有不在新账内的普通窗口(取消勾选/显示器已拔/几何重建的旧窗/孤儿兜底窗)。
        // 先建后关已满足(新建在上面循环完成);新账为空则跳过(全关即退出应用)。
        let keep: Vec<String> = next.values().map(|a| a.label.clone()).collect();
        if !keep.is_empty() {
            for w in app.webview_windows().into_values() {
                let label = w.label().to_string();
                if label.starts_with(NORMAL_PREFIX) && !keep.contains(&label) {
                    let _ = w.close();
                }
            }
        }

        store_map(next);

        // 通知所有窗口的设置面板刷新显示器列表与勾选状态
        let _ = app.emit(
            "monitors-changed",
            MonitorStateDto {
                monitors,
                selected: app_settings::load_selected(),
            },
        );

        has_normal_window(app)
    }

    /// 窗口销毁回调:从记账中移除该 label(用户手动关窗后,记账不再引用死窗口)
    pub fn forget(label: &str) {
        if !label.starts_with(NORMAL_PREFIX) {
            return;
        }
        let mut guard = ASSIGNMENTS.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(m) = guard.as_mut() {
            m.retain(|_, a| a.label != label);
        }
    }

    /// 兜底窗口:显示器枚举失败时使用,与旧版单窗口行为一致(主屏全屏居中)。
    /// 只在启动路径(setup,事件循环前)调用,同步 build 安全。
    /// 枚举恢复后由 reconcile 正常接管(其 label 不在记账内,会被清理关闭)。
    pub fn fallback_window(app: &AppHandle) {
        let label = next_label();
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Flip Clock · 翻页时钟")
        .inner_size(1280.0, 800.0)
        .fullscreen(true)
        .decorations(false)
        .resizable(true)
        .center()
        .background_color(tauri::webview::Color(10, 10, 15, 255));

        #[cfg(windows)]
        {
            builder = builder.data_directory(crate::webview_data_dir());
        }

        let _ = builder.build();
    }
}

// ==================== 显示器拓扑变化监听 ====================
// 独立线程创建隐藏顶层窗口接收 WM_DISPLAYCHANGE 广播。
// 注意不能用 message-only 窗口(HWND_MESSAGE):它不接收系统广播消息。
// 300ms 防抖:睡眠唤醒/拔插瞬间拓扑会连续抖动,只处理最终稳定态。
#[cfg(windows)]
mod display_listener {
    use std::sync::OnceLock;
    use tauri::AppHandle;

    const WM_DISPLAYCHANGE: u32 = 0x007E;
    const WM_TIMER: u32 = 0x0113;
    const TIMER_ID: usize = 1;
    const DEBOUNCE_MS: u32 = 300;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: *mut std::ffi::c_void,
        message: u32,
        w_param: usize,
        l_param: isize,
        time: u32,
        pt: Point,
    }

    #[repr(C)]
    struct WndClassW {
        style: u32,
        lpfn_wnd_proc: Option<unsafe extern "system" fn(*mut std::ffi::c_void, u32, usize, isize) -> isize>,
        cb_cls_extra: i32,
        cb_wnd_extra: i32,
        h_instance: *mut std::ffi::c_void,
        h_icon: *mut std::ffi::c_void,
        h_cursor: *mut std::ffi::c_void,
        hbr_background: *mut std::ffi::c_void,
        lpsz_menu_name: *const u16,
        lpsz_class_name: *const u16,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetModuleHandleW(lp_module_name: *const u16) -> *mut std::ffi::c_void;
        fn RegisterClassW(lpwc: *const WndClassW) -> u16;
        fn CreateWindowExW(
            dw_ex_style: u32,
            lp_class_name: *const u16,
            lp_window_name: *const u16,
            dw_style: u32,
            x: i32,
            y: i32,
            n_width: i32,
            n_height: i32,
            hwnd_parent: *mut std::ffi::c_void,
            h_menu: *mut std::ffi::c_void,
            h_instance: *mut std::ffi::c_void,
            lp_param: *const std::ffi::c_void,
        ) -> *mut std::ffi::c_void;
        fn DefWindowProcW(
            hwnd: *mut std::ffi::c_void,
            msg: u32,
            w_param: usize,
            l_param: isize,
        ) -> isize;
        fn GetMessageW(lp_msg: *mut Msg, hwnd: *mut std::ffi::c_void, min: u32, max: u32) -> i32;
        fn TranslateMessage(lp_msg: *const Msg) -> i32;
        fn DispatchMessageW(lp_msg: *const Msg) -> isize;
        fn SetTimer(
            hwnd: *mut std::ffi::c_void,
            id: usize,
            elapse: u32,
            timer_proc: Option<unsafe extern "system" fn()>,
        ) -> usize;
        fn KillTimer(hwnd: *mut std::ffi::c_void, id: usize) -> i32;
    }

    /// 启动监听线程;线程随主进程退出自动终止(主线程返回时全部线程被回收)
    pub fn spawn(app: AppHandle) {
        let _ = APP.set(app);
        std::thread::spawn(|| unsafe {
            let class_name: Vec<u16> = "FlipClockDisplayListener\0".encode_utf16().collect();
            let hinstance = GetModuleHandleW(std::ptr::null());
            let wc = WndClassW {
                style: 0,
                lpfn_wnd_proc: Some(wnd_proc),
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                h_instance: hinstance,
                h_icon: std::ptr::null_mut(),
                h_cursor: std::ptr::null_mut(),
                hbr_background: std::ptr::null_mut(),
                lpsz_menu_name: std::ptr::null(),
                lpsz_class_name: class_name.as_ptr(),
            };
            if RegisterClassW(&wc) == 0 {
                crate::app_log("display_listener: RegisterClassW FAILED");
                return;
            }
            // 隐藏顶层窗口(style 0 = WS_OVERLAPPED,从不 ShowWindow),可接收系统广播
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                crate::app_log("display_listener: CreateWindowExW FAILED");
                return;
            }
            let mut msg: Msg = std::mem::zeroed();
            loop {
                let r = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
                if r <= 0 {
                    break; // WM_QUIT 或错误
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: *mut std::ffi::c_void,
        msg: u32,
        w_param: usize,
        l_param: isize,
    ) -> isize {
        match msg {
            WM_DISPLAYCHANGE => {
                // 拓扑变化:重置防抖计时,等稳定后统一收敛
                KillTimer(hwnd, TIMER_ID);
                SetTimer(hwnd, TIMER_ID, DEBOUNCE_MS, None);
                0
            }
            WM_TIMER => {
                KillTimer(hwnd, TIMER_ID);
                if let Some(app) = APP.get() {
                    let app2 = app.clone();
                    // 经 async_runtime::spawn 派发 reconcile(运行时窗口操作的
                    // 可靠模式,裸线程/主线程执行都出过冻结/死锁)
                    let _ = tauri::async_runtime::spawn(async move {
                        crate::window_manager::reconcile(&app2);
                    });
                }
                0
            }
            _ => DefWindowProcW(hwnd, msg, w_param, l_param),
        }
    }
}

#[cfg(not(windows))]
mod display_listener {
    pub fn spawn(_app: tauri::AppHandle) {}
}

// ==================== 显示位置相关命令 ====================

#[tauri::command]
fn list_monitors() -> Vec<monitors::MonitorInfo> {
    monitors::enumerate().unwrap_or_default()
}

#[tauri::command]
fn get_selected_monitors() -> Vec<String> {
    app_settings::load_selected()
}

/// 必须是 async 命令:同步命令在主线程执行,而 build() 在主线程上下文
/// 同步调用会与 WebView2 初始化互相等待,Windows 上直接死锁(wry#583,
/// Tauri 官方文档明确要求创建窗口的命令用 async)。
#[tauri::command]
async fn set_selected_monitors(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Err("至少选择一个显示器".to_string());
    }
    // 所选项必须至少有一台在线,否则窗口会整体落到主屏,与用户意图相悖
    let Some(list) = monitors::enumerate() else {
        return Err("无法枚举显示器".to_string());
    };
    if !list.iter().any(|m| ids.contains(&m.id)) {
        return Err("所选显示器均未连接".to_string());
    }
    // 原样保存(含离屏项:显示器重连后自动恢复显示)
    app_settings::save_selected(&ids);
    // 窗口收敛经 async_runtime::spawn 派发(运行时窗口操作的可靠模式),
    // 命令立即返回:设置已落盘,即使收敛异常也不丢配置
    let app2 = app.clone();
    let _ = tauri::async_runtime::spawn(async move {
        window_manager::reconcile(&app2);
    });
    Ok(())
}

/// 屏保模式:所有显示器各建一个独立窗口铺满(不遵循"显示位置",保持既有行为)
fn create_saver_windows(app: &tauri::AppHandle, init_script: &str) {
    #[cfg(windows)]
    {
        let monitors = monitors::enumerate().unwrap_or_default();
        if !monitors.is_empty() {
            for (i, mon) in monitors.iter().enumerate() {
                let label = format!("saver-{i}");
                let mut builder = tauri::WebviewWindowBuilder::new(
                    app,
                    label,
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("Flip Clock · 翻页时钟")
                .decorations(false)
                .always_on_top(true)
                .resizable(false)
                // 先隐藏,定位到目标显示器后再 show,避免窗口在主屏闪现后跳移
                .visible(false)
                .background_color(tauri::webview::Color(10, 10, 15, 255))
                .initialization_script(init_script)
                // 临时尺寸,set_size 会用物理尺寸覆盖
                .inner_size(800.0, 600.0);
                builder = builder.data_directory(webview_data_dir());
                if let Ok(window) = builder.build() {
                    // 精确定位到对应显示器(物理坐标,不受 DPI 缩放影响)
                    let _ = window.set_position(tauri::PhysicalPosition::new(mon.x, mon.y));
                    let _ = window.set_size(tauri::PhysicalSize::new(
                        mon.width as u32,
                        mon.height as u32,
                    ));
                    let _ = window.show();
                }
            }
            return;
        }
    }
    // 兜底:单窗口全屏(枚举失败或非 Windows)
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "saver-0",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Flip Clock · 翻页时钟")
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .background_color(tauri::webview::Color(10, 10, 15, 255))
    .initialization_script(init_script);
    #[cfg(windows)]
    {
        builder = builder.data_directory(webview_data_dir());
    }
    let _ = builder.build();
}

/// 检测启动模式:解析 Windows 屏保命令行参数
/// /s — 屏保运行态(全屏展示,任意输入退出)
/// /c — 配置模式(控制面板"设置"按钮),直接退出,配置由主应用设置面板处理
/// /p — 预览模式(控制面板小显示器),直接退出,Tauri webview 无法嵌入外部 HWND
fn detect_mode() -> &'static str {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return "normal";
    }
    let cmd = args[0].to_lowercase();
    if cmd.starts_with("/s") || cmd.starts_with("-s") {
        "saver"
    } else if cmd.starts_with("/c") || cmd.starts_with("-c") {
        "config"
    } else if cmd.starts_with("/p") || cmd.starts_with("-p") {
        "preview"
    } else {
        "normal"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 标记主线程(日志中 MAIN 标记即此线程;卡死排查核心)
    logging::mark_main_thread();

    // 原生崩溃捕获:硬崩溃(访问违例/栈溢出/堆损坏)不走 Rust panic,
    // 此前这类闪退在日志中毫无痕迹;现在会留下 NATIVE-CRASH 异常码与地址
    crash_handler::install();

    // 全局 panic 记录到日志文件:发布版无控制台,不记录则崩溃原因完全不可见
    std::panic::set_hook(Box::new(|info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "?".to_string());
        app_log(&format!("PANIC at {loc}: {info}"));
    }));

    let mode = detect_mode();
    app_log(&format!("================ app start, mode={mode} ================"));
    app_log(&format!(
        "exe: {:?}",
        std::env::current_exe().unwrap_or_default()
    ));

    // /c(配置)和 /p(预览)模式:直接退出,不创建窗口
    // 配置由主应用的设置面板处理;预览嵌入需要 Win32 SetParent,Tauri webview 不支持
    if mode == "config" || mode == "preview" {
        return;
    }

    let is_saver = mode == "saver";

    // 屏保模式:通过 initialization_script 在页面 JS 执行前注入全局变量
    // 避免使用 location.replace 导致页面重载(重载会导致帧率下降/卡顿)
    let init_script = if is_saver {
        "window.__LAUNCH_MODE__ = 'saver';"
    } else {
        ""
    };

    tauri::Builder::default()
        .on_window_event(|window, event| {
            match event {
                // 窗口销毁时清理记账(取消勾选/拔显示器/关窗后,记账不再引用已死窗口)。
                // 注意:用户点 X 的退出走前端 exit_app 命令,不在这里处理——
                // CloseRequested 也可能来自 reconcile 的单个关窗,不能混为一谈
                tauri::WindowEvent::Destroyed => {
                    window_manager::forget(window.label());
                }
                _ => {}
            }
        })
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 动态创建窗口:不在 tauri.conf.json 中定义,避免 /c /p 模式闪现窗口
            if is_saver {
                create_saver_windows(app.handle(), init_script);
            } else {
                // 普通模式:按"显示位置"设置收敛窗口(默认主屏单窗)
                let ok = window_manager::reconcile(app.handle());
                if !ok {
                    // 枚举失败兜底:主屏单窗(与旧行为一致),监听器待拓扑恢复后接管
                    window_manager::fallback_window(app.handle());
                }
                // 监听显示器拔插/分辨率/主屏切换,防抖后自动收敛窗口
                display_listener::spawn(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            register_screensaver,
            unregister_screensaver,
            is_screensaver_registered,
            get_screensaver_timeout,
            set_screensaver_timeout,
            exit_saver,
            exit_app,
            list_monitors,
            get_selected_monitors,
            set_selected_monitors,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // 保留 Exit 留痕:区分"正常退出"与"硬崩溃(日志戛然而止)"
            if matches!(event, tauri::RunEvent::Exit) {
                app_log("run-event: Exit 进程正常退出");
            }
        });
}
