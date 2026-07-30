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
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let scr_path = get_scr_path()?;

        // 复制 exe → .scr(Windows 屏保本质就是改后缀的 exe)
        fs::copy(&exe, &scr_path).map_err(|e| format!("复制 .scr 失败: {e}"))?;

        let scr_str = scr_path.to_string_lossy().to_string();

        // 写入注册表:HKCU\Control Panel\Desktop
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = hkcu
            .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE)
            .map_err(|e| format!("打开注册表失败: {e}"))?;

        desktop
            .set_value("SCRNSAVE.EXE", &scr_str)
            .map_err(|e| format!("写入 SCRNSAVE.EXE 失败: {e}"))?;
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            register_screensaver,
            unregister_screensaver,
            is_screensaver_registered,
            get_screensaver_timeout,
            set_screensaver_timeout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
