# 桌面小部件 · 阶段总结与 v2 规划

## 一、已完成(v1)

### 功能

- **窗口形态双模式**:全屏(多显示器收敛)/ 桌面小部件(单置顶小窗),设置面板切换,重启记忆
- **票根皮肤(Ticket Stub)**:米白纸面 + 虚线撕裂分隔 + 半圆撕口(mask 镂空)+ 油墨数字 + 红色验讫章 + Code39 风格宽窄条形码(固定图案)+ 票号
- **数字动画**:里程表式滚动(行程 ±0.28em,位移/透明度双动画分离,旧值先隐完、新值后显足,无双实重叠)
- **交互**:任意位置拖拽(pointer 捕获 + setPosition,突破原生顶部钳制)/ 双击回全屏 / 右键菜单(显示秒、回到全屏、退出)/ 悬停显 X 与三角缩放手柄
- **缩放**:三角手柄拖拽,锁定 340:152 长宽比(宽驱动高,Resized 矫正天然收敛),票面整体等比 scale
- **持久化**:位置 + 尺寸存 Rust 侧 settings.json(物理坐标,节流 500ms + 退出兜底),启动校验可见性,无效回退主屏右下角
- **显示秒**:右键菜单开关,与全屏 showSeconds 共享(settings-sync 互通)

### 关键技术决策(踩坑记录)

| 问题 | 结论 |
|---|---|
| `data-tauri-drag-region` 只对标记元素本身生效(子元素不继承) | 改手动 pointer 拖拽 + 4px 阈值保点击语义 |
| 原生 startDragging 顶部钳制(无标题栏也受限) | 同上,setPosition 无钳制 |
| 形态切换先关后建 → 末窗关闭进程退出 | apply_window_mode 先建后关,建失败保留旧窗 |
| 透明窗口阴影 | 原生 shadow 矩形渗色 → shadow(false);投影用 CSS drop-shadow,范围须小于窗口留白(当前 0 3px 6px ≈ 15px < 20px) |
| 透明像素仍参与命中测试 | 异形突出(撕口/微倾)控制在 ≤8px,可接受 |
| reconcile 只认 normal- 前缀 | widget- 前缀天然隔离,小窗模式 reconcile 挂起 |
| 多开争抢共享 WebView2 数据目录 | tauri-plugin-single-instance,二次启动聚焦已有窗口 |

## 二、v2 规划

1. **系统托盘 + 开机自启**(常驻伴侣标配):`skip_taskbar` 后托盘是找回入口;`tauri-plugin-autostart` 登录自启
2. **穿透锁定模式**:右键菜单加"锁定"项,`set_ignore_cursor_events(true)` 后小窗不挡鼠标(解锁走托盘菜单)
3. **皮肤系统框架**:小窗皮肤(skin)作为与全屏主题正交的独立维度,右键菜单/设置面板可选;皮肤自带完整配色
4. **皮肤二号:机械台钟(Split-Flap)**——规格见下节
5. **机械 tick 音效**:整分/整点可选(Web Audio,默认关)
6. **ConfigPage 同步**:屏保配置页(/c)补窗口形态与小窗设置项

## 三、设计 A · 机械台钟(Split-Flap)前端设计规格

> 小窗皮肤二号。忠实还原电磁翻页钟:深色金属机身 + 贯穿铰链轴 + 沉头螺丝 + 近黑卡仓。**此皮肤回归翻页动画**(FlipCardGroup 直接复用,卡片带衬板)——机械翻页正是它的灵魂。

### 尺寸与窗口

- 票面(机身)264×116,窗口 304×156(四边 20px 留白供投影)
- 长宽比锁定 304:156(≈1.95:1),min 240×124,max 608×312
- 透明窗口三件套同票根;阴影 `drop-shadow(0 3px 6px rgba(0,0,0,0.45))`

### DOM 结构

```
.widget-root
└── .widget-drag
    └── .mecha-wrap(rotate 0° · scale)
        └── .mecha(机身 264×116,圆角 14px)
            ├── .mecha__screw--tl / --tr / --bl / --br(四角沉头螺丝)
            ├── .mecha__hinge(贯穿中缝铰链轴,两端轴帽)
            ├── .mecha__slot(卡仓:内凹暗槽,包两组 FlipCardGroup + 冒号)
            └── .mecha__engrave(底部蚀刻 "FLIP CLOCK")
```

### 材质与配色(皮肤自带,不跟随主题)

| 部位 | 实现 |
|---|---|
| 机身 | `#26262b` 底 + 顶边 1px `#3d3d44` 高光 + 底边 1px `#101012` 切削线;拉丝质感用 `repeating-linear-gradient(90deg, transparent 0 2px, rgba(255,255,255,0.012) 2px 3px)` 极淡竖纹 |
| 卡仓 | 内凹:`#0c0c0e` 底 + `box-shadow: inset 0 2px 8px rgba(0,0,0,0.8)`,与机身落差 6px 内边距 |
| 翻页卡 | `--card-from/to: #101013` 近黑,`--digit: #efe6d0` 米白(Anton),`--seam: #26262b`(与机身同色,视觉融入铰链) |
| 铰链 | 5px 高 `#0c0c0e` 圆角横贯 + 两端 9px 轴帽(`#3a3a41` 径向高光),z-index 压翻片 |
| 螺丝 | 7px 圆,`#17171a` + `inset 0 1px 2px rgba(0,0,0,0.8)` + 一字槽(1px 横线 `transform: rotate(各不同角度)`) |
| 蚀刻 | 8px 字、字距 3px、`#4a4a52`,`text-shadow: 0 -1px 0 rgba(0,0,0,0.6)`(阴刻感) |

### 动画与透视

- FlipCard 原样复用;`.mecha .flip-unit { perspective: 9em; }`(小尺寸 em 化透视)
- 冒号:两点 `#3a3a41`,可选 1Hz 呼吸(半秒亮半秒暗,模拟氖管)
- 整点 tick 音(v2 第 5 项)在此皮肤上最贴合

### 交互

与票根完全一致:任意位置拖拽 / 双击回全屏 / 右键菜单 / 悬停显 X 与手柄。
差异:X 与手柄配色换深灰金属风(`#3a3a41` 底、`#efe6d0` 字),悬停可暖白。
