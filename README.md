# BeatStride

BeatStride 是一个基于 Electron + React + TypeScript 的桌面音频工具，面向跑步听歌场景，支持 BPM 分析、变速对齐、节拍器叠加、单曲试听、串烧试听、素材代理生成、单曲导出与串烧导出。

## 当前能力

- Electron 安全架构：`preload + contextBridge + IPC`，renderer 无 Node 全权限
- 欢迎页 / 主编辑器 / 设置页 / 导出面板
- 本地音频导入（按钮 + 拖拽）
- ffmpeg/ffprobe 本地二进制自动检测
- ffprobe 音频元数据探测
- 导入时自动 BPM 分析，支持对单曲重新分析 BPM
- 轨道参数编辑：`sourceBpm / targetBpm / downbeatOffset / metronomeOffset / trim / fade / volume / pan`
- 右侧微调面板：节拍与变速、节拍器渲染、过渡与响度参数
- 微调项说明提示：参数名旁问号悬浮解释
- 工作区交互：
  - 整行单选
  - 复选框多选
  - 拖拽排序
  - 顶栏批量生成代理文件
- 工作区试听：
  - 单曲试听 / 串烧试听
  - 原曲对比 / 变速试听 / 节拍器叠加
  - 模式热切换
  - 音量控制
  - 进度条拖动定位
- 节拍器逻辑：
  - 音乐变速与节拍器叠加分离
  - 节拍器始终可按全局目标 BPM 打点
  - 使用自定义节拍器素材路径
- 素材代理：
  - 在项目目录下生成 `beatstride-proxies`
  - 状态显示：未生成 / 生成中 / 已生成 / 已过期
  - 支持批量生成、停止生成、进度提示
- 导出链路：
  - 单曲导出（变速 + 混入节拍器 + 可选 loudnorm）
  - 串烧导出（逐曲渲染后拼接，支持基础 crossfade）
- Chromium 不兼容格式播放代理：对原始 `m4a` 等文件生成可播代理用于试听
- 项目文件保存/打开、自动保存恢复
- 开发者模式：可打开 Electron DevTools 进行 Console 调试
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
- Windows 10/11

当前开发和资源路径默认按 Windows 环境处理，尤其是 ffmpeg 与节拍器素材路径。

## 本地 ffmpeg 放置

支持以下路径自动探测（按顺序）：

1. 设置页手动填写路径
2. `<项目根>/resources/ffmpeg/ffmpeg(.exe)` 与 `ffprobe(.exe)`
3. `<项目根>/ffmpeg/ffmpeg(.exe)` 与 `ffprobe(.exe)`
4. 打包后 `process.resourcesPath/ffmpeg/*`

当前仓库已包含：

- `resources/ffmpeg/*`（已同步）
- `resources/metronome/180BPM.mp3`

## 启动开发

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm run typecheck
npm run test
npm run lint
npm run build
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

## 典型工作流

1. 导入音频文件或文件夹
2. 等待导入阶段完成 BPM 分析
3. 将待加载区歌曲加入工作区
4. 在右侧拍点对齐区修正 `原始 BPM / 目标 BPM / 首拍偏移 / 节拍器偏移`
5. 在下方工作区进行单曲或串烧试听，必要时热切换原曲、变速和节拍器模式
6. 如需加速后续操作，可为工作区歌曲生成素材代理
7. 确认参数后执行单曲导出或串烧导出

## 代理文件说明

- `生成代理文件` 生成的是素材代理，不是最终导出成品
- 素材代理不会提前叠加节拍器，也不会提前做导出级混音
- 代理文件默认保存在项目目录下的 `beatstride-proxies` 子目录
- 工作区会显示每首歌的代理状态
- 试听时如果原始文件不适合 Chromium 直接播放，程序还会内部生成播放代理，这与项目级素材代理是两条独立链路

## 节拍器与对齐说明

- 音乐目标 BPM 与节拍器 BPM 可以不同
- 例如 `110 BPM` 的歌可以只温和拉到 `120 BPM`，同时节拍器仍按 `180 BPM` 打点
- 自动对齐目前采用这些规则：
  - `< 100 BPM` 才进入半拍映射
  - `100-125 BPM` 优先考虑 `120 BPM` 舒适目标
  - 节拍器默认以全局目标 BPM 作为打点速度
- 节拍器叠加需要对齐变速后的音乐拍点，相关逻辑统一在 render plan 中处理

## 示例工程

- `examples/beatstride-sample.runbeat-project.json`

## 关键模块说明

- `src/shared/services/exportPlanService.ts`
  - 将项目/轨道数据编译成统一 render plan，负责音乐目标 BPM、节拍器 BPM 和拍点对齐规则
- `src/main/services/ffmpegService.ts`
  - 负责 ffmpeg 命令执行、试听预览音频准备、素材代理生成、单曲和串烧导出
- `src/main/services/playbackProxyService.ts`
  - 为 Chromium 不支持直接解码的源文件生成播放代理
- `src/main/services/tempoDetectionService.ts`
  - 负责 BPM 检测与导入阶段节奏分析
- `src/shared/services/ffmpegArgsBuilder.ts`
  - 统一构建滤镜图和编解码参数，避免命令字符串散落
- `src/renderer/src/stores/playbackStore.ts`
  - 负责单曲/串烧试听、热切换、实时节拍器调度和播放状态管理

## 已知限制

- 时间线编辑仍是轻量实现，尚未达到 DAW 级多轨剪辑交互
- 自动 BPM 分析仍可能需要人工复核，尤其是切分复杂或节奏变化明显的歌曲
- 节拍器素材与实时节拍器调度仍在持续优化，复杂素材下需要进一步调校
- 串烧复杂重叠场景的精细混音规则仍有继续增强空间
- 当前 README 以 Windows 开发环境为主，跨平台路径行为需额外验证

## 后续迭代建议

1. 波形渲染升级（wavesurfer/canvas + 缓存）
2. 更细粒度的拍点锚点编辑与 nudge
3. 更完整的 export queue（取消/重试/并发策略）
4. BPM 检测策略扩展插件化（aubio/librosa/Essentia）
5. 项目版本迁移、代理缓存签名与恢复策略继续加强
