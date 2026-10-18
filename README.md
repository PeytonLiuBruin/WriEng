# WriEng · 词汇邮局

Windows 本机英语主动回忆网站：情境理解→隐藏答案→独立手写或键入→提交揭晓→间隔复习→跨日回忆。无需账号，学习数据不上传。

## 立即试用

本机预览 **http://127.0.0.1:4173/** 保持运行，只绑定 loopback，没有公开部署。原来已打开旧版时，请选择页面的更新提示；学习记录会先备份再迁移。

服务停止后双击 `Start-WriEng.cmd`，或在本目录运行 `npm run preview`。

新机器需要 Node.js 24 LTS（24.15+；另支持26+）（本机验证为24.20.0）：

```powershell
npm ci --ignore-scripts
npm run build
npm run preview
```

首次联网打开后等待「离线词库已就绪」，再关闭网络。应用、当前词库、频率表和三维资源都在完整缓存内；设备语音的离线能力另取决于本机声音。开发使用 `npm run dev` / http://127.0.0.1:5173/，开发模式不注册离线缓存。不同端口属于不同存储空间，切换前请导出备份。

## GitHub Pages 发布

Pages 的目标地址为 **https://peytonliubruin.github.io/WriEng/**；该地址必须在 GitHub Actions 部署成功、外网实测后才算上线。当前本机预览仍为上面的本地地址。

仓库工作流 `.github/workflows/pages.yml` 在 `main` 推送时运行锁文件安装、类型检查、单元/组件测试和生产构建，再仅上传 `.build-next` 静态文件。发布构建设置 `VITE_BASE_PATH=/WriEng/`；普通本地构建仍使用 `/`。Actions 的部署任务只申请 Pages 发布及 OIDC 所需权限，不需要项目密钥。

首次发布需要已有的 GitHub 账户具备该仓库写权限，并在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。工作流不创建新令牌、不更改账户授权；如果本机没有已有 Git 登录，推送会明确失败，不能把本地构建视为已上线。

Windows 手动构建子路径版本（会替换 `dist` 的当前本地构建，因此本地根地址预览应使用默认构建）：

```powershell
$env:VITE_BASE_PATH = '/WriEng/'
npm run build
Remove-Item Env:VITE_BASE_PATH
```

公开站点与本机是不同的浏览器存储来源。先在本机“记录”页面导出备份，再在公开站点导入，进度不会自动跨域同步。Pages 只托管静态应用；学习记录、手写和录音仍留在浏览器本地。

当前子路径、完整浏览器检查与截图见 [Pages验证记录](docs/TEST-REPORT-PAGES.md)。

## v0.2 的真实三维旅程

旅程地图使用 **Three.js 0.186.1 / WebGL 2**，原创程序化邮局、回忆桥、花园、灯塔和青蛙邮差阿忆。支持拖动旋转、滚轮/双指缩放、重置视角、站牌和列表双向选择，提供等价键盘操作。

场景进入旅程后才加载，练习时卸载；静止时按需渲染，交互最多提交30帧/秒，限制DPR与阴影预算，隐藏/离屏暂停。降低动态效果、低性能、WebGL缺失或context loss时显示明确标注的二维地图，节点信息完整保留。首页等距SVG仍是轻量插画，不称其为WebGL三维。详见 [WebGL说明](docs/WEBGL.md)。

## 真实频率与内容

**172个独立词义、344对双语例句**。路线重叠：IELTS97、TOEFL90、六级112、GRE67、美国日常58。新增72条补足租房维修、账单、诊所沟通、购物、工作安排、学术论证与研究设计；原100条复读并修正variable实验表述、grocery单义一致性，保留原ID。

通用频率来自 **wordfreq 3.1.1** 实际 `zipf_frequency(term, 'en', wordlist='best')` 输出。172项独立复算一致，保留原始值、版本、wheel/数据哈希、署名、导入脚本与依赖锁定。**通用英语混合语料估计不等于考试频率、美国口语排名、词义频率或实时语料**；全部考试频率仍为未知 `null`。词库支持通用频率/字母排序，到期复习仍优先。

16组字段逐项保留来源、地址、版本、许可、改编说明、复核状态与日期。原创文本CC0，独立频率派生表CC BY-SA 4.0，wordfreq代码Apache 2.0，CMUdict原始音素BSD许可。CMU覆盖171词；copay没有该字典条目，明示null。IPA和节奏仍待专业复核。

详见 [内容来源与可复现导入](docs/CONTENT-SOURCES.md)、[选择与审查记录](docs/CONTENT-REVIEW-V2.md)。不是完整考试题库或专业教师认证。

## FSRS与旧记录保护

排程使用 **ts-fsrs 5.4.2 / FSRS-6（MIT）**，固定完整参数、21权重和版本，关闭随机扰动。90%是默认排程目标，不是用户实测记忆率，也不是针对WriEng学习者训练的参数。

旧schema1事件不改标FSRS，原始失败、提示、提交时间与有效到期点保留。迁移在IndexedDB事务中自动保存升级前原始快照，再写schema2；记录页可导出旧快照，不会自动覆盖恢复。旧版客户端遇到新schema会拒绝写入。

提示、提前揭晓、重试和错误强制Again。初次新卡的实际输出为Again约10分钟、Hard约15分钟、Good约2天；之后由库按状态计算。界面用实际排程预估，不再使用固定1/3/7天阶梯。详见 [调度与迁移](docs/SCHEDULER.md)。

## 手写与发音边界

手写为Canvas/Pointer Events，无OCR。提交后显示本轮内存笔迹供对照自评；下一词或退出释放，刷新不会恢复图像，不把有线条当学会。键入关闭浏览器纠错和拼写提示，原始提交会保留；两种证据分别记录。

已有IPA、音节/主重音、中文发声提示、美音优先设备语音、整词和例句正常/慢速播放、用户明确开始的本机录音/回放/删除。录音不上传，没有准确率。“整词慢速播放”就是降低语速，没有逐音素同步、最小对立词、口型动画、真人音库、自动纠音或专业评分，也没有接入Google发音产品。

本地英文数字墨迹识别调研见 [HANDWRITING-OPTIONS.md](docs/HANDWRITING-OPTIONS.md)。本机Windows Chrome没有对应识别API；Windows Ink需原生桥接和语言组件，ML Kit官方面向Android/iOS，图像OCR也不是笔画时序识别。本轮没有安装或运行未知SDK、模型或脚本。识别文字本身不能证明学会。

## 验证与复现

```powershell
npm run typecheck
npm test
npm run build
# 保持另一个终端的 npm run preview 运行：
npm run test:e2e
node tests/pwa-lifecycle.mjs
```

单元与组件测试98项通过；生产浏览器结果、截图和模拟边界见 [v2验证报告](docs/TEST-REPORT-V2.md)。使用本机已安装Chrome的隔离headless上下文，不读取用户profile。原版记录保留在 [v1报告](docs/TEST-REPORT.md)。

普通启动不需要Python。维护者重建词频时按内容来源文档准备本项目隔离环境与哈希锁定的官方PyPI wheel。已有环境复算：

```powershell
.venv/Scripts/python.exe scripts/import-frequency.py --check --as-of 2026-10-17
```

构建先在`.build-next`生成完整产物并校验哈希，再原子替换预览壳；保留旧哈希资源供已打开客户端继续使用。PWA仍需用户明确更新，不清除IndexedDB。

## 本地数据与剩余限制

没有云同步，进度仅在当前浏览器/端口。清除浏览器数据会丢失记录，请定期导出。导入先校验后合并，重复不重复计分，冲突或超限不部分写入；上限100MB UTF-8、50,000个唯一事件。

没有长期学习效果试验。模拟跨日不等于长期随访；手写自评、拼写、听辨和语境运用不是同一种能力证据。下一步应优先专业语言/发音复核和受控学习验证，再有针对性扩库。

全部开发保存在本机，未推送、未公开部署、未开付费服务。Three.js/ts-fsrs完整MIT许可、wordfreq代码/数据声明和CMUdict许可均在`public/licenses/`并随构建分发。
