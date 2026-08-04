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

    // ===== 显示器枚举(用于屏保多显示器支持) =====
    // 使用 EnumDisplayMonitors + GetMonitorInfoW 获取每个显示器的物理坐标和尺寸。
    // 物理坐标不受 DPI 缩放影响,可直接配合 SetWindowPos 精确定位到指定显示器。

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        flags: u32,
    }

    /// 单个显示器的物理矩形(单位:像素)
    pub struct MonitorRect {
        pub x: i32,
        pub y: i32,
        pub width: i32,
        pub height: i32,
    }

    type MonitorEnumProc = unsafe extern "system" fn(
        hmonitor: *mut std::ffi::c_void,
        hdc: *mut std::ffi::c_void,
        lprc: *mut Rect,
        lparam: isize,
    ) -> i32;

    #[link(name = "user32")]
    extern "system" {
        fn EnumDisplayMonitors(
            hdc: *mut std::ffi::c_void,
            lprc_clip: *const Rect,
            lpfn_enum: MonitorEnumProc,
            dw_data: isize,
        ) -> i32;

        fn GetMonitorInfoW(hmonitor: *mut std::ffi::c_void, lpmi: *mut MonitorInfo) -> i32;
    }

    unsafe extern "system" fn enum_proc(
        hmonitor: *mut std::ffi::c_void,
        _hdc: *mut std::ffi::c_void,
        _lprc: *mut Rect,
        lparam: isize,
    ) -> i32 {
        let mut mi: MonitorInfo = std::mem::zeroed();
        mi.cb_size = std::mem::size_of::<MonitorInfo>() as u32;
        if GetMonitorInfoW(hmonitor, &mut mi) != 0 {
            let vec = &mut *(lparam as *mut Vec<MonitorRect>);
            vec.push(MonitorRect {
                x: mi.rc_monitor.left,
                y: mi.rc_monitor.top,
                width: mi.rc_monitor.right - mi.rc_monitor.left,
                height: mi.rc_monitor.bottom - mi.rc_monitor.top,
            });
        }
        1 // 继续枚举
    }

    /// 枚举所有显示器的物理矩形
    pub fn enum_monitors() -> Vec<MonitorRect> {
        let mut monitors: Vec<MonitorRect> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                enum_proc,
                &mut monitors as *mut Vec<MonitorRect> as isize,
            );
        }
        monitors
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
    let mode = detect_mode();

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

    // 共享 WebView2 用户数据目录:app.exe 和 FlipClock.scr 使用同一缓存
    // 否则 .scr 副本会创建独立缓存目录,导致冷启动慢、无 GPU 着色器缓存
    #[cfg(windows)]
    let webview_data_dir = {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(local)
            .join("com.flipclock.app")
            .join("webview-data")
    };

    tauri::Builder::default()
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
                // 屏保模式:为每个显示器创建独立窗口,各自铺满对应屏幕。
                // 用 EnumDisplayMonitors 枚举物理矩形,build 后用 set_position/set_inner_size
                // (物理坐标)精确定位,规避多显示器混合 DPI 下的逻辑坐标换算问题。
                #[cfg(windows)]
                {
                    let monitors = win_api::enum_monitors();
                    if monitors.is_empty() {
                        // 枚举失败时回退到单窗口全屏
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
                        builder = builder.data_directory(webview_data_dir.clone());
                        builder.build()?;
                    } else {
                        for (i, mon) in monitors.iter().enumerate() {
                            let label = format!("saver-{}", i);
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
                            // 临时尺寸,set_inner_size 会用物理尺寸覆盖
                            .inner_size(800.0, 600.0);
                            builder = builder.data_directory(webview_data_dir.clone());
                            let window = builder.build()?;
                            // 精确定位到对应显示器(物理坐标,不受 DPI 缩放影响)
                            window.set_position(tauri::PhysicalPosition::new(mon.x, mon.y))?;
                            window.set_size(tauri::PhysicalSize::new(
                                mon.width as u32,
                                mon.height as u32,
                            ))?;
                            window.show()?;
                        }
                    }
                }
                #[cfg(not(windows))]
                {
                    tauri::WebviewWindowBuilder::new(
                        app,
                        "saver-0",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("Flip Clock · 翻页时钟")
                    .fullscreen(true)
                    .decorations(false)
                    .always_on_top(true)
                    .background_color(tauri::webview::Color(10, 10, 15, 255))
                    .initialization_script(init_script)
                    .build()?;
                }
            } else {
                // 普通模式(双击打开):单个全屏窗口,只在主屏显示
                let mut builder = tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("Flip Clock · 翻页时钟")
                .inner_size(1280.0, 800.0)
                .fullscreen(true)
                .decorations(false)
                .resizable(true)
                .center()
                .background_color(tauri::webview::Color(10, 10, 15, 255))
                .initialization_script(init_script);

                #[cfg(windows)]
                {
                    builder = builder.data_directory(webview_data_dir.clone());
                }

                builder.build()?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
