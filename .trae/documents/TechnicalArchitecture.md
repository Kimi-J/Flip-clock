## 1. 架构设计

```mermaid
flowchart TD
    "前端展示层" --> "时钟核心组件"
    "前端展示层" --> "设置面板组件"
    "前端展示层" --> "氛围背景层"
    "时钟核心组件" --> "FlipCard 翻页卡"
    "FlipCard 翻页卡" --> "3D 变换动画引擎"
    "时钟核心组件" --> "时间状态管理"
    "设置面板组件" --> "主题切换"
    "设置面板组件" --> "显示项控制"
    "时间状态管理 --> localStorage 持久化"
    "主题切换 --> CSS 变量"
```

纯前端单页应用,无后端服务。状态通过 React hooks 管理,用户偏好持久化到 localStorage。

## 2. 技术说明
- 前端: React@18 + TypeScript + tailwindcss@3 + vite
- 初始化工具: vite-init (react-ts 模板)
- 动画: 纯 CSS 3D transform + transition,无需额外动画库
- 字体: Google Fonts (Bebas Neue, Oswald, Noto Sans SC)
- 后端: 无
- 数据库: 无

## 3. 路由定义
| 路由 | 用途 |
|-------|---------|
| / | 时钟主界面(单页) |

## 4. 组件结构
```
App
├── AmbientBackground        // 氛围背景层(光晕+噪点)
├── ClockStage               // 时钟舞台容器
│   ├── FlipCardGroup        // 翻页卡组(时/分/秒)
│   │   └── FlipCard         // 单个翻页卡(上/下两半)
│   ├── ColonSeparator       // 冒号分隔(呼吸动画)
│   └── InfoBar              // 日期/星期/问候语
├── ControlBar               // 控制条(全屏/设置)
└── SettingsPanel            // 设置浮层
```

## 5. 关键状态
```typescript
interface ClockSettings {
  theme: 'amber' | 'minimal' | 'midnight' | 'matrix';
  is24Hour: boolean;
  showSeconds: boolean;
  showInfoBar: boolean;
  backgroundMode: 'aurora' | 'particles' | 'solid';
}
```

## 6. 翻页动画原理
- 每个数字位由两层卡片组成:上半卡(显示当前值上半)、下半卡(显示当前值下半)
- 数字变化时:
  1. 在上半卡上方叠加一个"翻转卡",初始显示旧值上半
  2. 翻转卡绕中线 X 轴旋转 -90deg,同时下半卡下方叠加一个"翻转卡",从 90deg 旋转到 0
  3. 旋转完成后,更新静态卡为新值,移除翻转卡
- 使用 CSS `transform-style: preserve-3d` + `backface-visibility: hidden` 实现真实 3D 翻转
