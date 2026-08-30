# Flip Clock · 翻页时钟

一款基于 Tauri 2 + React + TypeScript 构建的 Windows 桌面翻页时钟应用。

三个核心卖点：**全屏沉浸显示**（启动即全屏、覆盖任务栏、单叶片 180° 翻页动画）、**系统屏保集成**（可注册为 Windows 屏保，多显示器独立铺满）、**精致外观定制**（9 套主题 + 3 种背景效果）。

## 功能特性

**时钟显示**

- 全屏翻页时钟 — 启动即全屏，整块屏幕作为渲染区域，覆盖任务栏；数字采用单叶片 180° 连续翻页动画
- 12 / 24 小时制一键切换
- 秒数翻页与底部日期信息栏均可选开启/关闭

**屏幕保护**

- 可注册为 Windows 系统屏保，空闲后自动启动
- 等待时间 1-60 分钟可调，与系统控制面板设置双向同步
- 多显示器下每台显示器独立全屏窗口，混合 DPI 也能精准落位

**外观定制**

- 10 套主题配色，每套拥有独立的视觉语言（详见[外观定制](#外观定制)）
- 3 种背景效果：极简（纯色）/ 极光（流动光晕）/ 星空（粒子星点）

**窗口与交互**

- 鼠标移至右上角显示最小化 / 设置 / 关闭按钮
- 设置持久化 — 所有偏好通过 localStorage 保存，重启后自动恢复；多窗口（屏保态）间设置实时同步
- 同色背景防闪屏 — 启动时窗口背景与主题一致，无黑/白屏闪烁

## 外观定制

### 主题（10 套）

| 主题 | 风格说明 |
|---|---|
| 极简黑 | 纯黑背景 + 近黑灰卡片 + 白字，无渐变光晕 |
| 极简白 | 纯白背景 + 浅灰卡片 + 黑字，无渐变光晕 |
| 暖琥珀 | 温暖琥珀色调，复古翻页钟质感 |
| 晨雾白 | 米白晨雾色系，柔和安静 |
| 午夜蓝 | 深蓝紫渐变，夜色氛围 |
| 矩阵绿 | 经典终端绿，数字雨气质 |
| 像素界 | 直角切角卡片 + 网格纹理 + 霓虹描边，Press Start 2P 像素字体 |
| 霓虹波 | Synthwave 霓虹渐变，赛博夜城 |
| 水墨韵 | 自然曲线裁切卡片，ZCOOL 庆科黄油体，东方水墨气韵 |
| 奶芙紫 | 薰衣草酸奶黏土风，大圆角膨起卡片 + 压印数字 + 柔软折痕接缝，Baloo 2 圆胖字体 |

### 背景效果（3 种）

| 效果 | 说明 |
|---|---|
| 极简 | 纯色背景（默认） |
| 极光 | 多彩流动光晕，GPU 加速的形变与透明度动画 |
| 星空 | 粒子星点，缓慢漂移 |

## 屏幕保护程序

### 启用方式

在设置面板中开启"屏幕保护程序"开关后：

1. 应用会将自身复制为 `FlipClock.scr` 并注册到 Windows 系统屏保（写入 `HKCU\Control Panel\Desktop` 的 `SCRNSAVE.EXE`）
2. 拖动"等待时间"滑块可设置系统空闲触发时长（通过 `SystemParametersInfoW` 与系统设置双向同步）
3. 系统空闲达到设定时间后，自动以屏保模式启动：每台显示器一个独立全屏窗口
4. 移动鼠标、点击或按任意键即可退出屏保

### 运行模式

应用通过 Windows 屏保命令行参数区分运行模式：

| 参数 | 模式 | 行为 |
|---|---|---|
| （无） | normal | 普通桌面应用，主屏全屏，带完整交互控件 |
| `/s` | saver | 屏保运行态，所有显示器铺满，任意输入退出 |
| `/c` | config | 配置模式，直接退出（配置由主应用设置面板处理） |
| `/p` | preview | 预览模式，直接退出（WebView2 无法嵌入外部 HWND） |

### 多显示器与性能

- 屏保模式下为每台显示器创建独立全屏窗口，基于物理坐标定位（`EnumDisplayMonitors` + `GetMonitorInfoW`），混合 DPI 下也能精准落位
- `app.exe` 与 `FlipClock.scr` 共享同一 WebView2 数据目录（`%LOCALAPPDATA%\com.flipclock.app\webview-data`），屏保冷启动速度与帧率与手动开启一致

### 注册失败？

若安装在 Program Files 等受保护目录，注册时可能遇到写权限问题，应用会给出对应提示；必要时以管理员身份运行，或手动将 `FlipClock.scr` 复制到 `C:\Windows\System32`。

## 开发指南

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.77.2+
- [Tauri CLI 前置依赖](https://tauri.app/start/prerequisites/)（Windows 需要 WebView2 和 MSVC 构建工具）

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（同时启动 Tauri 开发模式）
npm run tauri dev
```

浏览器开发模式下可通过 URL query 调试不同运行态：`?mode=saver`（屏保态）、`?mode=preview`（预览态）、`?mode=config`（配置态）。

### 构建生产包

```bash
npm run tauri build
```

构建产物（当前版本 2.1.0）：

- **可执行文件**：`src-tauri/target/release/app.exe`
- **NSIS 安装包**：`src-tauri/target/release/bundle/nsis/Flip Clock_2.1.0_x64-setup.exe`

### 版本号管理

版本号分布在三处，升级时需保持一致（Tauri 不会自动同步，漏改会导致 exe 属性/安装包名停留在旧版本）：

| 文件 | 影响范围 |
|---|---|
| `src-tauri/tauri.conf.json` 的 `version` | exe 文件属性（FileVersion/ProductVersion）、NSIS 安装包文件名 |
| `src-tauri/Cargo.toml` 的 `version` | Rust 二进制版本（构建时写入 Cargo.lock） |
| `package.json` 的 `version` | 前端 npm 包版本 |

## 技术架构

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.x |
| 前端 | React 18 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 图标 | Lucide React |
| 后端 | Rust（winreg 注册表 / user32 FFI） |

### 项目结构

```
├── src/                        # 前端源码
│   ├── components/
│   │   ├── FlipCard.tsx        # 单个翻页卡片（单叶片 180° 翻转）
│   │   ├── FlipCardGroup.tsx   # 时/分/秒数字组
│   │   ├── AmbientBackground.tsx # 背景效果（极简/极光/星空）
│   │   ├── InfoBar.tsx         # 底部日期信息栏
│   │   ├── ControlBar.tsx      # 右上角窗口控制按钮
│   │   └── SettingsPanel.tsx   # 设置面板（主题/背景/屏保等）
│   ├── pages/
│   │   ├── Home.tsx            # 主时钟页面
│   │   └── ConfigPage.tsx      # 配置模式页面
│   ├── hooks/useClockTime.ts   # 时间刷新 Hook
│   ├── store/clockStore.ts     # Zustand 状态 + localStorage 持久化
│   ├── App.tsx                 # 入口，区分普通/屏保/配置/预览模式
│   └── index.css               # 全局样式、主题变量与翻页动画
├── src-tauri/                  # Tauri/Rust 后端
│   ├── src/lib.rs              # 窗口创建、屏保注册、系统 API（FFI）
│   ├── src/main.rs             # 入口
│   ├── capabilities/           # Tauri 权限配置
│   ├── icons/                  # 应用图标（多尺寸）
│   └── tauri.conf.json         # Tauri 配置
├── index.html                  # HTML 入口
├── vite.config.ts              # Vite 配置（Tauri 适配）
└── package.json
```

### 参考文档

- [Windows.md](Windows.md) — Windows 多显示器窗口定位机制的深度研究报告（屏保多窗口实现的背景资料）

## License

MIT
