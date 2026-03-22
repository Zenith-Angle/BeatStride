你现在是一个资深 Electron + 音频工程 + 桌面产品工程师。请直接为我生成一个可以运行、可以继续迭代的桌面软件项目，不要只给架构建议，不要只给伪代码，不要只给文档。你要直接输出项目代码、目录结构、关键实现、必要注释，并按阶段完成。

# 项目名称
BeatStride

# 项目目标
开发一个基于 Electron 的桌面软件，面向跑步听歌场景。用户可导入本地音乐，设置目标 BPM（例如 180），将歌曲整体调整到目标节奏，并叠加本地节拍器音效，最后导出处理后的音频。

软件必须支持两种导出模式：
1. 串烧导出：把多首歌按时间线拼接为一首完整音频，可带淡入淡出 / 交叉淡化。
2. 单曲导出：对每首导入的歌曲分别做变速 + 节拍器叠加，然后单独导出，并添加后缀。

# 关键要求
这个项目最重要的点，不是单纯“调用 ffmpeg 变速”，而是：
**必须重点解决“原曲拍点与节拍器拍点的对齐问题”。**
如果拍点错开，听感会非常差，产品就不可用。

因此请把“拍点对齐”设计成最高优先级能力，而不是附属功能。
实现上不要偷懒成“全局变速后从 0 秒开始机械叠加 click 音”，而是要提供：
- BPM 检测 / 手动录入 / 手动修正
- downbeat / 首拍偏移校准
- 节拍器起始偏移
- 波形 / 时间线上的拍点可视化
- 用户手动拖动拍点网格或拖动节拍器轨道微调
- 导出前试听
- 最终渲染时严格按校准结果叠加

# 技术栈要求
- Electron
- 前端：React + TypeScript + Vite
- 状态管理：Zustand 或 Redux Toolkit，优先简单稳定
- UI：可用任意成熟组件库，但整体风格要现代、简洁、偏桌面工具
- 音频处理：
  - 运行时预览可使用 Web Audio API / wavesurfer / 自定义 canvas 波形
  - 最终导出必须基于本地 ffmpeg 可执行文件
- ffmpeg:
  - 用户不会自行安装全局 ffmpeg
  - 项目内约定存在本地 ffmpeg 可执行文件目录
  - 程序启动时自动检测 ffmpeg / ffprobe 是否存在
  - 所有调用都走项目内配置路径，不依赖系统 PATH
- 节拍器音效来自本地导入音频文件，可由用户指定
- 数据存储：
  - 项目配置、用户设置、最近工程、语言、主题、本地 ffmpeg 路径等保存在本地
  - 工程文件可保存 / 打开（例如 .runbeat-project.json）

# 安全与 Electron 约束
必须按现代 Electron 安全方式实现：
- renderer 不直接拿 Node 全权限
- 用 preload + contextBridge 暴露白名单 API
- 所有文件系统、ffmpeg、导出、系统对话框等能力都通过 IPC 调用
- 不要把敏感 Node API 暴露到 window 全局
- BrowserWindow 采用安全默认配置
- 不要使用 remote 模块

# 平台目标
优先支持：
- macOS
- Windows

可以暂不做 Linux 专项适配，但不要写死平台逻辑。

# 国际化要求
应用内置语言切换：
- 简体中文（默认）
- 繁体中文
- 英文
- 日语
- 法语

要求：
- 所有 UI 文案必须走 i18n 资源文件，不允许硬编码在组件里
- 默认语言是简体中文
- 语言切换后立即生效
- 数值、时间、文件大小显示尽量做本地化处理
- 请直接给出 i18n 目录结构和多语言资源示例

# 主题要求
支持 3 种主题模式：
- 系统
- 浅色（默认）
- 暗色

要求：
- 浅色主题：更有活力，主色可偏橙色 / 绿色，整体适合运动音乐工具
- 暗色主题：请你自行设计，但必须专业、耐看、适合长时间编辑音频
- 所有颜色走 design tokens / CSS variables，不允许散落硬编码
- 支持在设置里切换
- 系统模式下跟随系统主题
- 桌面原生窗口与自绘 UI 风格要协调

建议主题方向：
- Light:
  - primary: 活力橙
  - success/accent: 清爽绿
  - bg: 低饱和暖白
  - waveform active: 偏橙 / 亮绿
- Dark:
  - bg: 深灰蓝 / 炭黑
  - panel: 分层明显
  - primary: 低饱和霓虹橙或电光绿作为点缀
  - 不要做成廉价霓虹风

# 重要交互要求
这是桌面软件，不是网页 demo。请以桌面工作流设计。

必须包含以下页面 / 区域：
1. 欢迎页
   - 新建工程
   - 打开工程
   - 最近工程
   - ffmpeg 状态检查
2. 主编辑器
   - 左侧：歌曲列表 / 轨道列表
   - 中央：时间线 + 波形 + 拍点网格 + 节拍器轨道
   - 右侧：当前歌曲属性 / 导出设置 / 对齐参数
   - 顶部：工程操作、试听、导出、主题、语言、设置
3. 设置页
   - 语言
   - 主题
   - 默认导出目录
   - ffmpeg 路径
   - ffprobe 路径
   - 节拍器默认音色
   - 默认目标 BPM
   - 默认淡入淡出时长
   - 自动响度归一化开关
4. 导出面板
   - 单曲导出
   - 串烧导出
   - 文件命名规则
   - 导出格式
   - 采样率 / 比特率
   - 进度显示
   - 错误提示
   - 导出完成入口

# 交互细节要求
请务必覆盖这些细节：
- 支持拖拽导入音频文件
- 支持“点击按钮导入”
- 支持批量导入
- 支持拖动排序
- 支持多选歌曲
- 支持删除 / 替换音频
- 支持查看音频元数据（时长、采样率、声道、峰值、推测 BPM）
- 支持每首歌单独设置：
  - 原始 BPM
  - 目标 BPM（默认继承全局）
  - 节拍器开关
  - 节拍器音量
  - 歌曲音量
  - 左右声道平衡
  - 起始位置偏移
  - 前后裁切
  - 淡入
  - 淡出
  - 交叉淡化参与
  - 节拍器起始偏移
  - 首拍偏移 / downbeat offset
- 支持全局设置：
  - 全局目标 BPM
  - 默认拍号（先做 4/4，结构上允许未来扩展）
  - 默认节拍器音效
  - 默认导出参数
- 支持预听：
  - 原曲试听
  - 变速后试听
  - 节拍器叠加试听
  - 时间线局部循环试听
- 支持“拍点对齐辅助模式”：
  - 显示每拍垂线
  - 显示小节首拍高亮
  - 允许用户用“左移 / 右移一拍 / 半拍 / 10ms / 50ms”微调
  - 允许用户拖动首拍锚点
  - 提供“跟着节拍点按空格键 tap tempo”估算 BPM
- 支持撤销 / 重做
- 支持自动保存
- 支持崩溃恢复最近工程

# 必须特别处理的 Electron 桌面问题
在 Electron 中，自定义标题栏和拖动区域会影响点击、文本选择、拖拽体验，因此请在实现里明确处理：
- 自绘标题栏
- 指定 drag 区和 no-drag 区
- 所有按钮、输入框、下拉框必须位于 no-drag 区
- 拖动区域避免文本选中冲突
- 文件拖拽导入不要与窗口拖动冲突
- 歌曲列表拖动排序与窗口拖动区域严格隔离
- 时间线拖动 / 缩放 / 框选与窗口拖动严格隔离

注意：这部分不是可选优化，而是必须设计好的桌面交互基础设施。

# 音频处理核心设计
请实现并明确区分以下几个概念：

## 1. 原曲 BPM
- 可由用户手动输入
- 可通过 ffprobe / 外部分析逻辑 / 试听辅助估算
- 如果无法可靠自动识别，必须允许用户手动修正

## 2. 目标 BPM
- 用户指定，例如 180
- 可全局设置，也可单曲覆盖

## 3. 速度倍率 speedRatio
- speedRatio = targetBpm / sourceBpm
- 这是变速基础参数
- 但不是最终对齐的全部，仍需要首拍偏移和节拍器偏移

## 4. 首拍偏移 downbeatOffset
- 表示歌曲第一个有效强拍相对于音频起点的偏移时间
- 可以是正值
- 用户必须可手动调节
- 时间线中应可视化

## 5. 节拍器偏移 metronomeOffset
- 表示节拍器相对时间线的起点偏移
- 可独立微调，用于最终贴合

## 6. 时间线位置 trackStart
- 该歌曲在串烧总时间线中的起始位置
- 影响串烧导出
- 不影响单曲导出时的原始单曲起点语义

## 7. 响度
- 导出前可选择做响度归一化，避免不同歌曲切换时音量跳变太大

# 拍点对齐策略（这是最高优先级）
请按以下思路设计并实现：

## 基本原则
- 先确定歌曲的原始 BPM 和首拍偏移
- 再根据目标 BPM 计算变速倍率
- 对变速后的时间轴重新计算拍点位置
- 节拍器不是简单从 0 秒开始循环叠加，而是要从“修正后的首拍”开始对齐
- 导出时必须复用同一套对齐参数，保证试听与导出一致

## UI 必须提供的对齐能力
- 波形上显示拍线
- 可设置第一个小节首拍位置
- 可试听节拍器与原曲叠加效果
- 可微调 offset，直到主观听感一致
- 可保存每首歌的对齐参数
- 串烧中每首歌独立保存自己的对齐参数

## 初版可接受实现
第一版不用做复杂机器学习 beat tracking，但要做好工程结构，支持后续升级。
初版建议：
- 自动 BPM 估算：可先用简化方案，或者先允许用户手工输入并提供 tap tempo
- 首拍对齐：以人工校准为主
- 节拍器轨道：严格根据用户校准参数生成 click 时间点
- 试听与导出必须共用同一套 beat map / offset 计算逻辑

## 后续可扩展架构
请把拍点系统设计成可扩展模块，未来可以替换为：
- aubio / librosa / Essentia / 自定义 beat detection 服务
- 自动检测强拍 / downbeat
- 小节线推断
- 智能对齐建议

但是现在先把人工可校准版本做扎实。

# ffmpeg 使用要求
请用 Node 子进程调用本地 ffmpeg / ffprobe。
实现一个统一的 ffmpeg service。

至少支持以下能力：
- 探测音频元数据
- 导出单曲
- 导出串烧
- 变速
- 淡入 / 淡出
- 交叉淡化
- 混入节拍器音轨
- 延迟节拍器音轨实现对齐
- 响度归一化
- 导出进度解析
- 错误日志收集

## 关于变速
- 优先使用只改速度不改音高的方案
- 如果倍率超出稳妥区间，要拆成多个 atempo 链
- 不要偷懒只支持 0.5~2 的单级处理
- 要封装一个 buildAtempoChain(ratio) 方法

## 关于节拍器叠加
不要简单用一整条 click 循环音频粗暴拼接。
请设计可控方案：
- 基于 click 样本生成时间点序列
- 按拍点生成 click 音频片段
- 可区分强拍 / 弱拍（架构预留，第一版至少先支持单一 click）
- 将 click 序列拼成 metronome track
- 再与歌曲混音
- 支持节拍器音量单独调节

## 关于串烧导出
需要支持：
- 顺序拼接
- 每首歌自己的 trackStart
- 可选空白间隔 gap
- 可选交叉淡化 crossfade
- 每首歌自己的音量 / 平衡 / 淡入淡出
- 最终整体响度可选归一化

## 关于单曲导出
每首歌独立导出
文件名追加后缀，例如：
- songname__bpm180__metronome.wav
- songname__bpm180__mix.mp3

# 文件格式支持
导入尽量支持：
- mp3
- wav
- m4a
- flac
- aac
- ogg

导出先支持：
- wav
- mp3

结构上预留未来扩展到：
- flac
- aac

# 数据模型
请你直接设计 TypeScript 类型，并在项目中实现。至少包含：

- AppSettings
- ProjectFile
- ProjectMeta
- Track
- TrackAlignment
- TrackExportSettings
- TimelineClip
- ExportJob
- FfmpegBinaryConfig
- ThemeMode
- LanguageCode

建议字段示例（可完善）：
- Track:
  - id
  - name
  - filePath
  - duration
  - sampleRate
  - channels
  - detectedBpm
  - sourceBpm
  - targetBpm
  - speedRatio
  - downbeatOffsetMs
  - metronomeOffsetMs
  - trackStartMs
  - trimInMs
  - trimOutMs
  - fadeInMs
  - fadeOutMs
  - volumeDb
  - pan
  - metronomeEnabled
  - metronomeVolumeDb
  - exportEnabled
- ProjectFile:
  - version
  - createdAt
  - updatedAt
  - globalTargetBpm
  - timeSignature
  - defaultMetronomeSamplePath
  - tracks
  - exportPreset
  - theme
  - language

# 项目目录要求
请直接生成清晰目录结构，例如：

/src
  /main
  /preload
  /renderer
    /app
    /components
    /features
      /library
      /timeline
      /alignment
      /export
      /settings
      /theme
      /i18n
    /hooks
    /stores
    /styles
  /shared
/resources
  /ffmpeg
  /metronome
  /i18n
/electron-builder 或 forge 配置
/scripts

请你根据实现细化。

# UI 设计要求
请做成“专业但不复杂”的音频工具，不要做成炫技 demo。

应具备：
- 现代桌面工作台布局
- 明确的层级
- 波形区域要突出
- 常用操作就近摆放
- 颜色与状态统一
- 所有按钮、表单、列表、拖拽状态、导出进度有明确反馈
- 空状态、错误状态、处理中状态要完整

建议组件：
- 顶部栏
- 左侧曲库 / 工程轨道区
- 中央时间线区
- 右侧属性检视器
- 底部播放与缩放控制区
- 导出模态框 / 抽屉
- 设置模态框 / 独立页

# 时间线要求
必须实现基础时间线系统，而不是简单列表参数页。
至少支持：
- 轨道块显示
- 缩放
- 横向滚动
- 播放头
- 当前时间显示
- 拍线 / 小节线显示
- 轨道块拖动调整起始位置
- trim handles
- fade handles
- 选中态
- 拍点锚点显示
- 节拍器轨道显示
- 局部试听范围

初版不要求 DAW 级别性能，但结构要能扩展。

# 预览与导出一致性要求
这是硬性要求：
- 试听时使用的参数模型，必须与导出时使用同一套数据结构
- 不能出现“试听一个效果，导出另一个效果”
- 所有 offset / bpm / trim / fade / volume / pan / metronome 参数统一走一套 render plan
- 请实现一个 renderPlan builder，把项目数据编译成“试听计划 / 导出计划”
- 预览可低精度，但语义必须一致

# 工程化要求
请直接搭建完整工程，并满足：
- TypeScript 严格模式
- ESLint
- Prettier
- 路径别名
- 基础单元测试
- 对关键纯函数写测试：
  - BPM ratio 计算
  - atempo 链拆分
  - 拍点时间生成
  - offset 对齐逻辑
  - 导出文件名生成
- 提供 README
- 提供启动方法
- 提供打包方法
- 提供本地 ffmpeg 放置说明
- 提供示例工程文件
- 提供至少 2~3 个核心模块的实现注释

# 生成策略要求
请不要一次只输出“下面是第一步”。你要尽可能完整地给出能运行的项目骨架和关键实现。
如果输出过长，可以分阶段输出，但每个阶段都必须给出实际代码，而不是只有说明。
优先顺序：
1. 先搭建可运行 Electron + React + TS 项目骨架
2. 接着实现 preload / IPC / settings / i18n / theme
3. 再实现项目数据模型和工程文件读写
4. 再实现音频文件导入与 ffprobe 元数据读取
5. 再实现时间线 UI 骨架
6. 再实现对齐面板和拍点系统
7. 再实现 ffmpeg 导出链路
8. 再实现串烧导出
9. 再补测试、README、示例资源说明

# 代码输出规则
- 直接给代码
- 明确文件路径
- 每个文件给完整内容
- 不要只给 diff
- 不要省略关键文件
- 不要把“剩余部分略”
- 不要用伪代码替代核心逻辑
- 对特别长的资源文件可以适度精简，但不能影响运行理解
- 所有临时 mock 都要显式标注 TODO
- 所有尚未完成的高级能力要在代码里留扩展点

# 必须实现的核心模块
请至少实现这些模块：

1. main process
- window 创建
- 安全配置
- IPC 注册
- 文件对话框
- 工程文件保存 / 打开
- ffmpeg 检测
- 导出任务调度

2. preload
- 暴露受控 API 给 renderer
- 类型声明完善

3. renderer
- 主布局
- 欢迎页
- 设置页
- 时间线编辑器
- 曲目属性面板
- 导出面板
- 主题切换
- 语言切换

4. shared types
- 全量类型定义
- 常量
- 校验

5. services
- ffmpegService
- ffprobeService
- projectService
- metronomeService
- beatGridService
- previewPlanService
- exportPlanService

6. stores
- appSettingsStore
- projectStore
- playbackStore
- exportStore

7. utils
- tempo utils
- time utils
- file name utils
- platform utils

# 必须实现的纯函数 / 算法
至少包含以下函数，并给出测试：
- computeSpeedRatio(sourceBpm, targetBpm)
- splitAtempoChain(ratio)
- generateBeatTimes(durationMs, bpm, offsetMs)
- alignMetronomeToDownbeat(track, globalSettings)
- buildSingleTrackExportPlan(track, settings)
- buildMedleyExportPlan(project, settings)
- buildOutputFileName(track, mode, suffixRules)

# ffmpeg 命令构建要求
请不要把 ffmpeg 命令直接散落在各处字符串拼接。
请封装成 builder / planner：
- 先根据项目状态生成 render plan
- 再根据 render plan 生成 ffmpeg args
- 便于测试
- 便于未来切换实现

# 推荐实现细节
请尽量采用以下思路：
- ffprobe 获取元数据
- waveform 可先用简化预处理方案
- 大文件不要一次性全读进内存
- 导出走任务队列
- 进度通过 stderr 解析
- UI 线程不要直接阻塞
- 长任务状态可中断 / 至少可标记取消
- 自动保存做节流
- project 文件带 version，方便未来迁移

# 可接受的第一版取舍
第一版可以不做：
- AI 自动打拍
- 复杂多拍号切换
- VST
- 多节拍器音色层
- 云同步
- 在线资源下载
- 实时高精度 DAW 引擎

但是第一版必须做好：
- 可运行
- 可导入
- 可设置 BPM
- 可校准首拍
- 可叠加节拍器
- 可试听基本效果
- 可单曲导出
- 可串烧导出
- 可切换语言
- 可切换主题
- 桌面拖拽和标题栏交互稳定

# 验收标准
你生成的项目至少应满足以下验收：
1. 可以启动桌面应用
2. 可以导入多首本地音频
3. 可以设置目标 BPM
4. 可以给单曲设置 source BPM
5. 可以调整 downbeatOffset 和 metronomeOffset
6. 可以在时间线看到拍线和轨道
7. 可以试听节拍器叠加效果（哪怕初版预览相对简化）
8. 可以导出单曲
9. 可以导出串烧
10. 可以切换简中 / 繁中 / 英文 / 日语 / 法语
11. 可以切换系统 / 浅色 / 暗色
12. 自绘标题栏和拖拽区域不影响按钮点击与时间线交互
13. README 能指导本地放置 ffmpeg 并运行项目

# 最终输出格式要求
请按以下顺序输出：
1. 项目总览
2. 完整目录结构
3. 所有关键文件代码（按路径分段输出）
4. 测试代码
5. README
6. 后续 TODO 列表

现在开始执行。直接产出项目，不要再反问我，不要只给建议。