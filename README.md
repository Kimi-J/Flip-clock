# Flip Clock · 翻页时钟

一款基于 Tauri 2 + React + TypeScript 构建的桌面翻页时钟应用，支持全屏显示、屏幕保护程序、多主题配色与 12/24 小时制切换。

## 功能特性

- **全屏翻页时钟** — 启动即全屏，整块屏幕作为渲染区域，覆盖任务栏
- **屏幕保护程序** — 可注册为 Windows 系统屏保，空闲后自动启动；支持自定义等待时间（1-60 分钟），直接接管系统屏保设置
- **多主题配色** — 琥珀、矩阵、极简、午夜、晨雾等多套配色方案
- **12/24 小时制** — 一键切换显示格式
- **秒针/日期显示** — 可选开启/关闭秒数、日期显示
- **窗口控制** — 鼠标移至右上角显示最小化/设置/关闭按钮
- **同色背景防闪屏** — 启动时窗口背景与主题一致，无黑/白屏闪烁

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.x |
| 前端 | React 18 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 图标 | Lucide React |
| 后端 | Rust（winreg / user32 FFI） |

## 开发环境

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

### 构建生产包

```bash
npm run tauri build
```

构建产物：

- **可执行文件**：`src-tauri/target/release/app.exe`
- **NSIS 安装包**：`src-tauri/target/release/bundle/nsis/Flip Clock_0.1.0_x64-setup.exe`

## 屏幕保护程序说明

在设置面板中开启"屏幕保护程序"开关后：

1. 应用会将自身复制为 `FlipClock.scr` 并注册到 Windows 系统屏保
2. 拖动"等待时间"滑块可设置系统空闲触发时长（与系统控制面板同步）
3. 系统空闲达到设定时间后，自动以全屏模式启动翻页时钟屏保
4. 移动鼠标、点击或按任意键即可退出屏保

应用使用共享 WebView2 数据目录，屏保启动速度与帧率与手动开启一致。

## 项目结构

```
├── src/                    # 前端源码
│   ├── components/         # UI 组件（ControlBar, SettingsPanel, ClockCard 等）
│   ├── pages/              # 页面（Home, ConfigPage）
│   ├── store/              # Zustand 状态管理
│   ├── App.tsx             # 应用入口，区分普通/屏保模式
│   └── index.css           # 全局样式与 CSS 变量
├── src-tauri/              # Tauri/Rust 后端
│   ├── src/lib.rs          # 应用入口，窗口创建、屏保注册、系统 API 调用
│   ├── capabilities/       # Tauri 权限配置
│   ├── icons/              # 应用图标（多尺寸）
│   └── tauri.conf.json     # Tauri 配置
├── index.html              # HTML 入口
├── vite.config.ts          # Vite 配置（Tauri 适配）
└── package.json
```

## License

MIT
