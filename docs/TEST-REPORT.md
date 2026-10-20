# WriEng Windows 本机验证报告

> 历史版本记录。图片和原始运行结果保留在本机；当前赛博版以 README 与 TEST-REPORT-V3.md 为准。

验证日期：2026-10-17。范围为此仓库的本地生产构建，未推送、未部署。

## 环境与实际构建

- Windows，本机 Node.js **24.20.0**、npm **11.19.0**。
- 使用已安装的 **Google Chrome 155.0.8059.84**；当时没有可复用的浏览器窗口。测试使用本机 Chrome 的隔离 headless 上下文，不使用用户 profile、历史记录或其他标签。
- TypeScript 7.0.2、React 19.3.1、Vite 8.3.4、Vitest 5.0.5、Playwright 1.64.1，版本固定，锁文件已保存。
- HTTP 实际访问 `http://127.0.0.1:4173/` 返回 **200**。仅绑定 Windows loopback。
- 最终生产构建：JS 395.07 kB / gzip 132.62 kB；CSS 42.39 kB / gzip 9.96 kB。离线缓存包含 **8 个文件、456,672 字节**，版本 `dbb8da678af14fc524da`。这是构建大小，不是加载速度、FPS 或 Lighthouse 分数。

## 已执行命令与结果

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过；`npm run build` 也先执行相同的 `tsc --noEmit` |
| `npm test` | **4 个测试文件、72 个测试通过** |
| `npm run build` | TypeScript、Vite、完整预缓存生成均成功 |
| `npm run test:e2e` | **8/8 通过，19.2秒，exit 0**；8项页面异常和控制台错误附件均为空 |
| `node tests/pwa-lifecycle.mjs` | **通过**：完整缓存、真实离线导航/刷新、失败更新回滚、等待确认、显式激活、作用域清理、IndexedDB 保留 |

本地完整端到端报告位于 `docs/e2e-report/index.html`，失败追踪/附件目录为 `docs/test-results/`；这些生成文件留在 Windows 本机，不进入源码提交。

## 单元和组件验证

53 项调度/数据测试验证：Again/Hard/Good 间隔与边界，到期优先，每日新词总上限，UTC 经过时间与 DST，提示/提前揭晓/重试强制短间隔，首次错误不被改正覆盖，手写只能为自评，重复与并发提交幂等，旧快照不丢新事件，待评反馈恢复，原始提交时间与确认时间分离，旧 v1 缺提交时间的兼容回填，备份去重/冲突回滚/伪造评级拒绝，v0 迁移，配额失败，100MB UTF-8 大小与50,000事件上限及超限回滚。

10 项组件测试验证：空白与单点不能作为有效书写；真实笔画、撤销与清空；像素密度/宽度变化重绘；禁用与多指；延迟美音声音列表、无 US 音色回退、慢速与重复取消；明确请求麦克风、拒绝权限、本机录音停止/播放/删除；切换词后迟到权限立即停流。声音缺失和录音拒绝为可复现的组件模拟，未声称在此电脑上实测物理麦克风或扬声器音质。

9 项内容测试验证全部100词的稳定ID、重复、完整字段、例句与迁移情境、路线规模、逐字段来源、未知频率不伪造、CMU音素/主重音一致性与错误数据拒绝。结构校验不等于专业语言认证。

## 真实浏览器场景

8 类场景覆盖：

1. 新用户路线/计划→学习情境→隐藏英文→独立键入→先提交后揭晓→确认调度→刷新恢复。反馈阶段会保留原始提交；模拟延迟评分时，原始提交时刻与评分时刻分别保存。
2. 手机空白/单点不能过关；Chrome 触控事件触发 `pointerType=touch` 的真实 Pointer Events 笔迹；提交后自评。原始笔迹仅供当前页面对照，刷新释放，不进入 IndexedDB。
3. 键入错误不能声称 Good，安排约10分钟后重练。
4. 完成5词后用固定测试时钟模拟次日，验证到期队列和另一日独立回忆证据。**不是实际长期随访或学习效果证明。**
5. 实际导出文件、读回、重复导入合并，损坏备份拒绝且原数据不变。
6. 等待完整缓存后，真实将浏览器上下文断网，应用与已缓存词库刷新成功，IndexedDB 记录恢复。
7. 全部主要导航、词库筛选/搜索、词义来源、旅程节点、设置与 reduced-motion。
8. 桌面1440、平板834、手机390、窄屏320，以及200%等效重排，无水平溢出。

200%检查采用1440物理宽度、720有效CSS视口与2x设备像素的等效重排，不冒称操作了Chrome原生缩放菜单。手机/平板是Windows Chrome尺寸与触控模拟，未测试实体 iOS/Safari、Android、Apple Pencil 或真实触控笔硬件。

降低动态效果不丢失功能。地图本身使用SVG/CSS等距图，无WebGL依赖；回忆阶段不显示地图动效。对话框有可见关闭按钮、ESC和键盘焦点边界；手写提供等价键盘作答路径。没有进行完整读屏器、WCAG认证或实测性能基准。

## 可审阅截图

截图均来自此Windows本地Chrome，文件位于 `docs/screenshots/`：

- `00-desktop-home.png`：桌面首页。
- `01-tablet-home.png`：平板布局。
- `02-mobile-home.png`：390px手机首页。
- `03-small-mobile-home.png`：320px窄屏。
- `04-typed-feedback.png`：键入提交后的真实反馈。
- `05-mobile-handwriting.png`：手机触控笔迹与提交状态。
- `06-next-day-due.png`：固定时钟模拟次日到期。
- `07-records-and-backup.png`：学习证据与备份。
- `08-offline-restored.png`：真实断网刷新后恢复。
- `09-journey-map.png`：基于事件的旅程地图。
- `10-200-percent-equivalent-reflow.png`：200%等效重排。
- `11-handwriting-self-assessment.png`：揭晓后仅在内存保留的笔迹对照。

## 内容抽检与当前限制

独立于内容编写过程，由另一模型辅助审查20词（每模块第1/7/13/20条），阅读词义、40条英文情境及中文、搭配、词性、IPA/重音，并对照本地CMU主重音：

| 模块 | 实际抽检 |
| --- | --- |
| academic | analyze / establish / factor / synthesize |
| science | adapt / species / variable / efficient |
| society | benefit / consequence / facilitate / sufficient |
| GRE | ambiguous / mitigate / benevolent / resilient |
| daily | receipt / available / tip / deductible |

已润色 mitigate 的中文例句，并给 deductible 的简化保险词义添加「具体以保单为准」。未发现阻塞构建的确定语法/义项错误；例如弱元音 IPA 变体仍需专业语音复核。这里没有声称全库人工教师审阅、官方考试覆盖、考试频率排名或真实CEFR评级。

词库实际为100独立词义、200双语例句对；IELTS66、TOEFL55、六级73、GRE35、美国日常26，路线重叠。所有频率为未知 `null`。下一项最有价值的内容工作是请语言/语音专业人员复核现有词义和变体，再引入许可明确且可验证的频率语料扩展。

手写没有OCR，键入只校验拼写，不声称全面掌握。语音使用实际本机声音（此环境检测到 Microsoft David en-US），没有专业发音评测服务和分数。调度是透明间隔v1启发式，尚未用学习者数据校准。所有进度仅在当前浏览器，没有云同步；需定期导出备份。

## 执行环境记录

最初及交付前均只读重新检查了指定GitHub远端，仍为空仓库；未覆盖远端新提交。checkout无`.agents/skills`或项目说明需要合并。没有读取其他项目、私人照片、浏览器资料或凭据，没有推送、公开部署或付费服务。

Library完整指引已通过授权内容读取获得，共135行。按支持流程向明确Windows目标 `task/instructions/WriEng-implementation-prompt.md` 尝试物化：沙箱网络检查后，放行运行原版传输辅助程序仍因Windows Python缺少 `os.setxattr` 失败，原子流程未留下目标文件。该落盘动作已停止，不猜下载地址、不修改辅助程序绕过元数据要求；开发按完整已读指引继续，核心产品没有因此阻塞。
