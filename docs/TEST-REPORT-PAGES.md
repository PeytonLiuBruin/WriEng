# GitHub Pages 发布准备与验证

> 历史版本记录。图片和原始运行结果保留在本机；当前赛博版以 README 与 TEST-REPORT-V3.md 为准。

验证日期：2026-10-18。源码版本应以本报告所在本地提交为准。

## 发布目标与边界

- 目标：`https://peytonliubruin.github.io/WriEng/`。
- 远端只读检查：仓库仍公开且没有任何分支；没有覆盖远端改动。
- Windows Git 的非交互已有凭据检查：退出码128，未找到可复用凭据；没有创建令牌、触发登录或扩大授权。
- 本地实现提交 `cafe1aa` 已实际执行一次 `git -c credential.interactive=never push -u origin main`，退出码1：`Cannot prompt because user interactivity has been disabled` / `unable to get password from user`。这是认证失败，不能声称已推送；没有重复尝试、强推或绕过认证。
- 目标网址实际外网HTTP检查：**404**。未把本地构建、提交或工作流文件视为已上线；没有成功的远端 Actions/Pages 运行可供声明。
- Pages 的首次启用需要仓库设置选择 **GitHub Actions**。工作流的 `configure-pages` 不请求额外管理权限自动启用站点。

## 实现

`VITE_BASE_PATH` 默认 `/`，Pages 构建设为 `/WriEng/`。修正入口、图标、manifest与全部七个公开数据/许可链接。manifest按相对路径启动；Service Worker 精确注册在应用子路径，缓存URL按scope解析，不接管同域其他路径。

`pages.yml` 使用锁定的官方 Actions 提交及Node24.20.0，依次执行 `npm ci --ignore-scripts`、类型检查、98项单元/组件检查和生产构建，仅上传 `.build-next` 的静态文件。构建只有 `contents:read`，部署只有 `pages:write` 和 `id-token:write`，没有PAT或项目密钥。构建目录没有Git、测试夹具、源码map、学习备份或私密文件。

## 实际本地结果

使用本台Windows已安装的 **Chrome155.0.8059.84**，隔离的headless测试上下文，不读取用户profile、私人标签或浏览器登录。

| 检查 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| 单元/组件：内容规则、FSRS、迁移、存储、交互 | **98/98通过** |
| 默认根地址完整浏览器：手写、键入、导入迁移、离线、WebGL及四种宽度 | **16/16通过，35.2秒** |
| 默认根构建与Pages构建 | 均成功；Three.js延迟块有已说明的大小提示 |
| 根路径与子路径独立PWA/资源测试 | 均通过 |
| Pages纵向浏览器检查 | **8/8通过** |
| 18个预缓存文件的HTTP、字节数与SHA-256 | 全部一致 |
| manifest启动URL、scope及三个图标 | 均在 `/WriEng/` |
| Service Worker范围与完整缓存 | 精确子路径，未控制范围外页面 |
| 五词学习→隐藏回忆→提交揭晓→刷新恢复 | 通过 |
| FSRS实际到期→跨日复习→事件保存 | 通过 |
| 断网首次加载三维地图、刷新、再提交 | 通过，最终7条事件保存 |
| 独立390px手机布局、词库与七个许可URL | 通过，无横向溢出 |
| JS、console、请求及HTTP意外错误 | 最终完整子路径运行均为空 |
| 工作流YAML结构、任务依赖、权限与SHA锁定 | 本地检查通过；不代表远端CI已运行 |

Pages产物预缓存版本 **`84fe06641ebbec7a04b7`**，18文件共 **1,211,135字节**。本机根构建预缓存版本 **`f0125675ddf9808a94b3`**，18文件共 **1,211,086字节**。预缓存清单以外另有生成的 `sw.js` 和 `sw-manifest.json`，发布共20静态文件。

原始完整子路径运行结果保存在本机忽略目录 `docs/test-results-pages/local-2026-10-18T00-18-55-035Z.json` 与 `local-latest.json`。早期本地服务网络边界和旧地图选择器产生的失败运行也保留在该目录；修正测试服务/选择器后最终运行退出0，产品代码没有为这些失败新增特殊逻辑。

## 实际截图

- 桌面首页（历史本机截图：`screenshots-pages/local-00-desktop-home.png`）
- 隐藏答案后的主动回忆（历史本机截图：`screenshots-pages/local-01-hidden-recall.png`）
- 提交反馈（历史本机截图：`screenshots-pages/local-02-typed-feedback.png`）
- 真实到期复习（历史本机截图：`screenshots-pages/local-03-due-review.png`）
- 离线三维地图（历史本机截图：`screenshots-pages/local-04-offline-map.png`）
- 离线刷新恢复（历史本机截图：`screenshots-pages/local-04-offline-restored.png`）
- 手机首页（历史本机截图：`screenshots-pages/local-05-mobile-home.png`）
- 手机词库（历史本机截图：`screenshots-pages/local-06-mobile-library.png`）

## 复现

```powershell
npm run typecheck
npm test
$env:VITE_BASE_PATH = '/WriEng/'
npx vite build --outDir .build-next
node scripts/generate-sw.mjs .build-next
node tests/pages-subpath.mjs .build-next /WriEng/
Remove-Item Env:VITE_BASE_PATH
npm run build
npm run preview
# 另一终端：
npm run test:e2e
```

完整Pages冒烟脚本可指定已启动的服务或真正上线后的地址：

```powershell
$env:WRIENG_TEST_URL = 'https://peytonliubruin.github.io/WriEng/'
node tests/pages-smoke.mjs
Remove-Item Env:WRIENG_TEST_URL
```

该脚本使用全新测试数据库，只在浏览器隔离上下文创建合成学习记录，不使用用户真实进度。公网404时不能把本地8/8结果移记成公网通过。

## 内容与能力限制

仍为172个独立词义、344组原创双语例句的精选首版，五条路线有重叠，不是完整考试词表。172项通用Zipf频率来自wordfreq3.1.1，考试频率未知；IPA与教学释义仍待专业人工复核。手写先写再自评，没有OCR判掌握；语音使用设备en-US声音，没有伪造专业发音分数。FSRS90%是目标参数，不是实测学习效果。

公网与本机进度属于不同origin；上线后需显式导出/导入备份，不能期待自动跨域同步。
