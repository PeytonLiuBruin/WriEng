# WriEng v2 · Windows 验证记录

> 历史版本记录。图片和原始运行结果保留在本机；当前赛博版以 README 与 TEST-REPORT-V3.md 为准。

最终生产构建 **`45aad13be490b7e9b0ef`** 在用户这台 Windows 电脑的 **`http://127.0.0.1:4173/`** 完成验证。最终浏览器回归 **16/16 通过，41.1 秒，exit 0**；没有跳过、重试后通过或未预期失败。主线程实际执行的 **98 条单元/组件测试、类型检查、生产构建、词频重生成检查与 PWA 生命周期回归也已通过**。本轮没有公开部署或推送远端。

## 环境与证据

- 使用本机已安装 **Google Chrome 155.0.8059.84**、Playwright 1.64.1；浏览器运行在用户 Windows 电脑上。
- 没有可复用的用户浏览器窗口，测试使用独立 headless 浏览器上下文，不读取用户 profile、历史或其他标签。
- 默认 Chromium 路径验证真实 WebGL2；另起带 **`--disable-webgl`** 的同一浏览器验证降级。未安装其他浏览器。
- 最终浏览器运行从 **2026-10-17 22:32:07 UTC** 开始，耗时 **41,096 ms**。JSON 结果为 `expected=16, unexpected=0, skipped=0, flaky=0`。
- HTML 报告：[e2e-report-v2/index.html](e2e-report-v2/index.html)；结构化结果：[test-results-v2/results.json](test-results-v2/results.json)。两者是本机生成的验证证据，不作为源码提交。
- 最终测试生成 **22 张编号截图**，位于 [screenshots-v2](screenshots-v2/)。已实际查看桌面 3D、320px 地图与首页、手机手写及自评、迁移记录、离线恢复、词频详情等最终截图；没有发现空画布、关键节点互相遮住或水平溢出。

## 实际执行结果

| 验证 | 结果 | 执行来源 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 主线程 |
| `npm test` | **98/98** 单元及组件测试通过 | 主线程 |
| `npm run build` | 类型检查、Vite、SW 清单和本地构建切换成功 | 主线程；QA 核对最终清单 |
| `.venv\Scripts\python.exe scripts\import-frequency.py --as-of 2026-10-17 --check` | 172 个真实词频值；171 个 CMUdict 音素条目；`copay` 缺失被明确保留 | 主线程 |
| `node tests/pwa-lifecycle.mjs` | 完整缓存、缺资源更新回滚、等待确认、显式激活、缓存清理、IndexedDB 保留通过 | 主线程；此前 QA 也执行过此独立浏览器回归 |
| `npm run test:e2e`，`WRIENG_TEST_URL=http://127.0.0.1:4173` | **16/16，41.1 秒，exit 0** | QA 最终生产运行 |

最初一轮迁移用例把真实按钮“导出升级前快照”误写成“导出升级前备份”。只修正测试选择器后，迁移单条通过，再完成整套回归。随后为地图补齐 44px 目标尺寸重新构建；本报告对应最后的 `45aad13be490b7e9b0ef`，不是早期开发预览或此前构建。

## 浏览器覆盖范围

1. **完整键入回忆闭环**：首次设置 → 学习情境 → 隐藏英文 → 主动输入 → 提交揭晓 → 评级 → FSRS 排程 → IndexedDB → 刷新恢复。提交时刻与延后 5 分钟的评级时刻分别保存；反馈页面刷新不会提前生成学习事件。
2. **手机手写**：空白和单点不能提交；通过 Chrome 触摸事件生成真实 Pointer Events 笔迹，提交后显示本次 PNG 对照。学习记录只保存 `hasInk` 与 `self-rated`，没有 OCR 正确率，原始图像不写入 IndexedDB；刷新后图像释放。
3. **错误不冒充 Good**：错误键入仅提供重学，保留原始错误文本，新事件带 FSRS 版本并安排短期纠正回忆。
4. **跨日到期**：完成 5 个词后，根据实际 FSRS `dueAt` 推进受控浏览器时钟，验证到期队列、隐藏答案的延迟回忆及新跨日事件。没有沿用旧 1/3 天固定阶梯。
5. **导入导出**：下载真实 JSON，重复导入不重复计分，损坏文件被拒绝且已有事件不变。
6. **v1 → schema 2 迁移**：见下文，包含旧事件、旧到期、新 FSRS 评级、升级前原始快照和跨上下文恢复。
7. **离线完整包**：缓存 URL 集合逐项等于当前 SW 清单，切断网络后搜索词库、首次进入 3D 地图、刷新首页与恢复学习成功。
8. **词频、来源与导航**：172 张词卡数对齐原始派生表；Zipf 降序、英文排序、卡片与详情数值对应源表；逐字段来源含 CC0 和 CC-BY-SA，考试频率未知说明可见；键盘 Escape 关闭模态框，保存的减少动效设置刷新后生效。
9. **响应式与重排**：首页验证 1440、834、390、320 CSS px；另验 720 CSS px × 2 倍像素密度的 200% 等效重排，无水平溢出。
10. **真实 3D 交互**：非空 WebGL2 绘制，鼠标拖动改变相机、滚轮及按钮缩放、重置视角、四个站点双向选择；短节点动画完成后没有持续提交空闲帧。
11. **真实上下文丢失**：调用 `WEBGL_lose_context.loseContext()`，正常切换二维地图，四个等价节点仍可操作，没有未捕获异常。
12. **系统 reduced-motion**：静态二维地图，不创建 3D canvas，不由页面导入 `WorldScene`。
13. **可见性与练习卸载**：模拟隐藏状态并发送 `visibilitychange` 后帧数停止，隐藏时请求缩放也不绘制，恢复后继续；打开练习时地图与 renderer 卸载。
14. **首轮练习隔离**：首页进入首次练习不创建 3D canvas，页面资源列表中没有 `WorldScene` 的动态导入。
15. **禁用 WebGL**：真实 `--disable-webgl` 启动参数下自动降级，四个等价节点可点选，没有未捕获异常。
16. **地图四尺寸与触摸目标**：320、390、834、1440 CSS px 均无水平溢出；模式切换与可见投影节点宽高均至少 44px，节点中心没有被遮住，实际点击可选择。

核心 App 测试的每条 `browser-errors` 附件中，`pageErrors` 和 `consoleErrors` 均为空；WebGL 生命周期每条 `webgl-page-errors` 附件也为空。

## 迁移的实际数据证据

通过应用文件输入上传 [src/fixtures/v1-progress.json](../src/fixtures/v1-progress.json)，没有直接向 IndexedDB 伪造新状态。

| 原事件 | 原始证据 | 原 dueAt | 迁移结果 |
| --- | --- | --- | --- |
| `v1-receipt-wrong` | `receipt-noun-1`；typed；原答案 `receit`；incorrect；2026-10-17 12:00 UTC | 2026-10-17 12:10 UTC | 事件全部字段与到期毫秒值不变 |
| `v1-analyze-good` | `analyze-verb-1`；handwriting；self-rated；`hasInk=true`；12:05 UTC | 2026-10-18 12:05 UTC | 事件全部字段与到期毫秒值不变 |

新状态为 schema 2，完整保存 21 个 FSRS 参数，旧事件继续标为 `wrieng-interval-v1`，旧预约进入 `legacyScheduleAnchors`。下载的升级前快照与原 v1 fixture 深相等。刷新后两条旧事件与 dueAt 仍相同。

随后在实际练习界面回忆并键入 `receipt`，得到带 `ts-fsrs-5.4.2-fsrs6-wrieng-v2` 和 `wrieng-fsrs6-retention90-v1` 的新事件。下载 schema-2 备份、重复导入、在全新浏览器上下文中导入并刷新后，事件列表和进度投影均深相等。原错误没有被新答案覆盖。

## 离线与 3D 的实际规模

最终 [sw-manifest.json](../dist/sw-manifest.json) 清单为 **18 个文件、1,211,051 字节**，缓存名是 `wrieng:/:45aad13be490b7e9b0ef`。实测缓存集合与清单的全部 URL 相等，包含应用、词频表、许可文件、`JourneyMap3D` 及 `WorldScene`。断网后才首次打开地图，3D 仍能初始化。

`WorldScene` 懒加载块为 **600.14 kB / gzip 152.86 kB**，触发 Vite 的 500 kB 大块提示。它在进入旅程页时才由页面动态导入和执行；Service Worker 为完整离线能力会预缓存该文件，因此“没有在首页执行 3D”不等于“首次缓存不下载 3D 资源”。reduced-motion 的页面资源测试也按此边界解释。

最终实际 renderer 诊断为 **Three.js r186 / WebGL2，39 draw calls，21,536 triangles，DPR 1**。这些是该自动化桌面上下文中一次实际渲染的计数，不是手机 FPS、硬件 GPU 性能、Lighthouse 分数或加载速度测量。空闲场景的帧数在节点动画结束后连续 220 ms 保持不变。

320px 与 390px 实测模式切换按钮均为 **87×44px**，四个投影节点均为 **78×44px**；全部中心点可命中对应按钮，实点后选择状态更新。相机工具的尺寸修正已包含在最终构建中。

## 最终截图索引

| 截图 | 说明 |
| --- | --- |
| 00-desktop-home.png（历史本机截图：`screenshots-v2/00-desktop-home.png`） | 1440px 桌面首页 |
| 01-tablet-home.png（历史本机截图：`screenshots-v2/01-tablet-home.png`） | 834px 平板布局 |
| 02-mobile-home.png（历史本机截图：`screenshots-v2/02-mobile-home.png`）、03-small-mobile-home.png（历史本机截图：`screenshots-v2/03-small-mobile-home.png`） | 390px / 320px 首页 |
| 04-typed-feedback.png（历史本机截图：`screenshots-v2/04-typed-feedback.png`） | 键入提交后的实际反馈 |
| 05-mobile-handwriting.png（历史本机截图：`screenshots-v2/05-mobile-handwriting.png`）、11-handwriting-self-assessment.png（历史本机截图：`screenshots-v2/11-handwriting-self-assessment.png`） | 手机笔迹及无 OCR 自评对照 |
| 06-next-day-due.png（历史本机截图：`screenshots-v2/06-next-day-due.png`） | 受控时钟推进到实际 FSRS 到期后 |
| 07-records-and-backup.png（历史本机截图：`screenshots-v2/07-records-and-backup.png`） | 记录与导入导出 |
| 08-offline-restored.png（历史本机截图：`screenshots-v2/08-offline-restored.png`） | 真实断网并刷新后恢复 |
| 09-journey-map.png（历史本机截图：`screenshots-v2/09-journey-map.png`）、12-webgl-orbit-map.png（历史本机截图：`screenshots-v2/12-webgl-orbit-map.png`） | 生产 WebGL 地图及交互后状态 |
| 10-200-percent-equivalent-reflow.png（历史本机截图：`screenshots-v2/10-200-percent-equivalent-reflow.png`） | 200% 等效重排 |
| 13-context-loss-fallback.png（历史本机截图：`screenshots-v2/13-context-loss-fallback.png`） | 真实 WebGL 上下文丢失后降级 |
| 14-reduced-motion-2d.png（历史本机截图：`screenshots-v2/14-reduced-motion-2d.png`） | 系统减少动效二维模式 |
| 15-webgl-disabled-fallback.png（历史本机截图：`screenshots-v2/15-webgl-disabled-fallback.png`） | `--disable-webgl` 降级 |
| 16-map-320px.png（历史本机截图：`screenshots-v2/16-map-320px.png`）、16-map-390px.png（历史本机截图：`screenshots-v2/16-map-390px.png`）、16-map-834px.png（历史本机截图：`screenshots-v2/16-map-834px.png`）、16-map-1440px.png（历史本机截图：`screenshots-v2/16-map-1440px.png`） | 四尺寸地图与 44px 节点 |
| 17-v1-migrated-records.png（历史本机截图：`screenshots-v2/17-v1-migrated-records.png`） | v1 实际导入，原始快照可导出 |
| 18-frequency-and-provenance.png（历史本机截图：`screenshots-v2/18-frequency-and-provenance.png`） | community 的实际 Zipf 5.34 与来源；详情滚动位置 |

截图是本机浏览器输出，手机长图中固定底栏停留在当时视口底部，属于真实 full-page 截图行为。目录中 `early-map*`、`scene-first*` 是早期开发检查，不属于以上最终 22 张生产证据。

## 验证边界

172 条是精选起始库，不是完整考试词表。所有 172 条有真实 wordfreq 3.1.1 通用英语混合语料估计；不能据此声称美国口语排名或考试频率。171 条有固定版本 CMUdict ARPABET；`copay` 缺失明确为 null。原创释义、例句、IPA 教学提示和幽默记忆线索仍待专业语言审校。详见 [CONTENT-SOURCES.md](CONTENT-SOURCES.md)。

跨日测试推进浏览器时钟，验证的是调度和保存行为，不是长期学习效果；90% 是 FSRS 排程参数，不是实测记忆率。200% 用 720 CSS px × 2x 密度进行等效重排，没有操作 Chrome 原生缩放菜单。

Headless Chrome 中不同标签都报告 visible。因此隐藏暂停用**模拟 `document.visibilityState` / `document.hidden` 与合成事件**验证事件处理、停帧及恢复，不宣称完成真实后台标签切换测量。WebGL 上下文丢失测试则使用真实扩展，未用模拟事件代替。

手机与平板是本机 Chrome 的视口/触摸模拟；未验证实体 iOS、Safari、Android、触控笔或真实移动 GPU。未执行 WCAG 全面审计、FPS 基准或真人发音评分。美式语音取决于设备实际可用声音，离线语音不能由应用缓存保证；录音权限与媒体 API 的拒绝/缺失分支有组件模拟覆盖，没有在这次自动化中访问用户真实麦克风。IndexedDB 没有云同步，浏览器清理存储仍可能使本地记录丢失，备份功能已实测。

最终没有剩余测试阻塞。运行步骤与本机预览见 [README.md](../README.md)。
