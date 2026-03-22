# BeatStride

BeatStride 是一个基于 Electron + React + TypeScript 的桌面音频工具，面向跑步听歌场景，支持 BPM 对齐、首拍偏移校准、节拍器叠加、单曲导出与串烧导出。

## 已实现第一版能力

- Electron 安全架构：`preload + contextBridge + IPC`，renderer 无 Node 全权限
- 欢迎页 / 主编辑器 / 设置页 / 导出面板
- 本地音频导入（按钮 + 拖拽）
- ffmpeg/ffprobe 本地二进制自动检测
- ffprobe 音频元数据探测
- 轨道参数编辑：`sourceBpm / targetBpm / downbeatOffset / metronomeOffset / trim / fade / volume / pan`
- 时间线基础视图：轨道块、拍线、播放头、缩放
- 拍点对齐工具：偏移微调、Tap Tempo
- 试听基础能力：原曲 / 变速 / 节拍器叠加（预览与导出共用 render plan 语义）
- 导出链路：
  - 单曲导出（变速 + 混入节拍器 + 可选 loudnorm）
  - 串烧导出（逐曲渲染后拼接，支持基础 crossfade）
- 项目文件保存/打开、自动保存恢复
- 多语言：简中、繁中、英文、日文、法文
- 主题：系统 / 浅色 / 暗色（CSS Tokens）
- 关键纯函数单测：ratio、atempo 拆分、拍点生成、对齐、导出计划、文件名

## 目录结构

```txt
.
├─src
│  ├─main
│  │  ├─ipc
│  │  └─services
│  ├─preload
│  ├─renderer
│  │  ├─src
│  │  │  ├─app
│  │  │  ├─components
│  │  │  ├─features
│  │  │  │  ├─alignment
│  │  │  │  ├─export
│  │  │  │  ├─i18n
│  │  │  │  ├─library
│  │  │  │  ├─settings
│  │  │  │  ├─theme
│  │  │  │  └─timeline
│  │  │  ├─hooks
│  │  │  ├─stores
│  │  │  └─styles
│  │  └─index.html
│  └─shared
│     ├─services
│     └─utils
├─resources
│  ├─ffmpeg
│  └─metronome
├─examples
└─tests
```

## 环境要求

- Node.js 20+
- npm 10+
- Windows/macOS

## 本地 ffmpeg 放置

支持以下路径自动探测（按顺序）：

1. 设置页手动填写路径
2. `<项目根>/resources/ffmpeg/ffmpeg(.exe)` 与 `ffprobe(.exe)`
3. `<项目根>/ffmpeg/ffmpeg(.exe)` 与 `ffprobe(.exe)`
4. 打包后 `process.resourcesPath/ffmpeg/*`

当前仓库已包含：

- `ffmpeg/ffmpeg.exe`
- `ffmpeg/ffprobe.exe`
- `resources/ffmpeg/*`（已同步）

## 启动开发

```bash
npm install
npm run dev
```

## 运行测试

```bash
npm run test
```

## 类型检查与规范

```bash
npm run typecheck
npm run lint
npm run format
```

## 打包

```bash
npm run package
```

## 示例工程

- `examples/beatstride-sample.runbeat-project.json`

## 关键模块说明

- `src/shared/services/exportPlanService.ts`
  - 将项目/轨道数据编译成统一 render plan（试听与导出共语义）
- `src/main/services/ffmpegService.ts`
  - 负责 ffmpeg 命令执行、节拍器轨道生成、单曲和串烧导出
- `src/shared/services/ffmpegArgsBuilder.ts`
  - 统一构建滤镜图和编解码参数，避免命令字符串散落

## 已知限制（第一版）

- 时间线拖动和剪辑句柄为基础实现，尚未 DAW 级交互
- 自动 BPM 检测当前以人工输入和 Tap Tempo 为主
- 节拍器导出为“按拍点序列拼接 click 片段”的工程化初版
- 串烧复杂重叠场景的精细混音规则后续增强

## 后续迭代建议

1. 波形渲染升级（wavesurfer/canvas + 缓存）
2. 拍点锚点拖拽与更精细 nudge（采样级）
3. 更完整的 export queue（取消/重试/并发策略）
4. beat detection 扩展插件化（aubio/librosa/Essentia）
5. 工程版本迁移与更强校验
