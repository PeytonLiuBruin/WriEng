# 英文数字墨迹识别选型记录

核查日期：2026-10-17。范围是用户实际画出的笔画序列转英文；“数字墨迹”指 digital ink，不是只识别数字 0–9。本次仅查阅官方文档、原项目与模型发布者的元数据，没有安装、下载或运行任何识别 SDK、模型或陌生 GitHub 脚本。

## 结论与当前状态

WriEng 当前仍采用真实笔迹输入、揭晓对照和用户自评，没有接入自动手写识别。若要优先满足这台 Windows 电脑的本地英文识别，最值得验证的是 **Windows Ink 原生宿主 + 受限 WebView2 桥接**。这是下一阶段工程建议，尚未实现，也没有验证本机是否已安装英文手写组件。

纯网页当前不能依靠 Windows Chrome 自动调用系统识别。ML Kit 是成熟的移动原生路线；已核查的 ONNX 候选是笔迹图像 OCR，不能冒充使用笔画时序的数字墨迹识别。下表的成熟度评价是基于这些资料与当前部署形态的工程判断，不是识别准确率测试。

| 路线 | 输入与实际平台 | 离线前提 | 下载/体积信息 | 对 WriEng 的判断 |
| --- | --- | --- | --- | --- |
| Windows Ink `InkRecognizerContainer` | 原生 `InkStrokeContainer`；Windows API | 安装相应系统手写识别组件；需原型断网验收 | 系统语言组件依 Windows 版本、架构而变，未取得统一可核实字节数 | Windows 本地识别的优先原型；需原生宿主与桥接 |
| Chromium Handwriting Recognition API | 显式传入笔画点；官方文档描述 ChromeOS 的英文实现 | 目标平台确有识别器 | 不应给 Windows 用户承诺可下载某个网页模型 | 可作为有条件增强；本机 Chrome 不提供接口 |
| ML Kit Digital Ink Recognition | `Ink` 点序列；官方支持 Android/iOS | 先下载语言模型，再在设备识别 | Android 文档给出每语言约 **20 MB 存储**；不等于 iOS 精确下载量 | 未来移动原生应用可评估；普通 Web/Windows 无官方入口 |
| ONNX / TrOCR 图像路线 | 单行笔迹**图片**，不消费原笔画时序 | 权重、运行时、分词器等资源均本地可用 | 下文示例量化权重两项合计约 **63.6 MB**，不是完整包 | 技术候选待审核；不是现成可交付的英文数字墨迹方案 |

## Windows Ink：有系统识别能力，但网页需要原生桥接

`InkRecognizerContainer` 负责管理已安装的识别器，`GetRecognizers()` 枚举它们，`RecognizeAsync()` 接收 `InkStrokeContainer` 并返回文字候选；系统缺少识别引擎时不能假定功能可用。该类也有线程与封送约束。[Microsoft API 文档](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.inkrecognizercontainer)

微软的单行识别示例依赖已安装语言包；用户可以另行安装语言的手写识别引擎。Windows 的 Handwriting FOD 与 OCR、语音、基础语言组件分开，且依赖同语言 Basic 组件。因此，安装了英语键盘或英文 Windows 界面，不足以证明英文手写识别器已就绪。本次没有安装或变更系统语言组件。[Windows Ink 识别流程](https://learn.microsoft.com/en-us/windows/uwp/ui-input/convert-ink-to-text)、[语言功能组件说明](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/features-on-demand-language-fod)

API 文档中的 JavaScript 投影并不表示普通网页可以访问 WinRT。也不能把所有 WinRT API 都说成“只能 UWP”：微软说明，C#/C++ 桌面应用可使用多数 WinRT API，但部分 API 依赖 UWP UI 或包身份，须逐项验证。`InkCanvas` 原生 UI、识别容器和浏览器的 `<canvas>` 是不同对象。[桌面 WinRT 支持限制](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support)

可验证的桥接设计是：WebView2 内的应用收集有序笔画，传给自有 C#/C++ 宿主；宿主构造 Windows Ink 笔画、调用识别器，将有限文字候选返回页面。微软提供了 host object 和 WinRT adapter 两类互操作说明；它们都需要原生工程、Windows 目标与相应工具链，不能通过给现有 PWA 加一个 npm 包完成。[WebView2 原生互操作](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/hostobject)、[WinRT 互操作工程](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/winrt-from-js)

工程成本为中高：原生项目与工具链、笔画坐标/时序转换、语言组件检测、异步取消与线程处理、发布包与更新、缺组件回退及离线测试都要承担。应只暴露明确的识别消息，不暴露通用系统代理；验证来源和消息参数，阻止外部网页继承桥接权限。这遵循微软对 WebView2 原生边界的要求。[WebView2 安全指导](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)

本地使用系统 API 不等于可将 Windows 识别引擎当作开源权重复制给其他系统。下一步若获授权实施，应先列明所需官方 SDK/工具链、语言组件与发布方式，再处理安装和系统变更审批；本次没有进行这些操作。

## Chrome 网页 API：版本号不等于目标平台可用

Chrome 官方文章说明该 API 从 Chromium 99 提供，当前文档中的实现说明针对 ChromeOS 的英文及手势模型。应用必须先检测接口，再检查所需语言/功能，处理无识别器和拒绝情况；不能推导“Windows Chrome 99+ 都支持”。Pointer Events 只收集输入，识别还需要显式构造 drawing/stroke 并调用预测接口。把点画到 Canvas 上，不会自动把它交给操作系统识别。[Chrome 官方指南](https://developer.chrome.com/docs/web-platform/handwriting-recognition)

2026-10-17，在这台 Windows 的既有 Chrome **155.0.8059.84**、安全的 `http://127.0.0.1:4173/` 页面，以全新隔离无头上下文作只读能力检查，实际得到：

```json
{
  "secureContext": true,
  "create": "undefined",
  "query": "undefined",
  "querySupport": "undefined"
}
```

检测的是 `navigator.createHandwritingRecognizer`、`navigator.queryHandwritingRecognizer`，另核对文档旧示例所用的 `queryHandwritingRecognizerSupport`。没有创建识别器或请求模型。该结果只证明本次 Windows Chrome 配置不可用，不推断其他操作系统或未来版本。

## ML Kit：移动端成熟方案，不能直接装进网页

Google 官方明确支持 Android/iOS；识别消费用户屏幕笔画，模型就绪后可完全离线。它与摄像头图片的文字识别 API 不同。官方没有给普通 Web 或 Windows 提供 Digital Ink SDK。[ML Kit 总览](https://developers.google.com/ml-kit/vision/digital-ink-recognition)

Android 通过 `RemoteModelManager` 下载、查询及删除语言模型，官方估计每语言约 20 MB 存储；iOS 通过自己的原生模型管理接口。实际完整安装量还包含 SDK，不能把 Android 的粗略数字当作跨平台精确下载大小。笔画顺序、点坐标、时间与书写区信息也需要正确传递。[Android 指南](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android)、[iOS 指南](https://developers.google.com/ml-kit/vision/digital-ink-recognition/ios)

隐私需要分开陈述：官方说输入与输出在设备处理且不传到 Google，但 SDK 可能联网获取模型/更新并发送性能和使用指标。不能宣传成“整个 SDK 永不联网”。模型适用 ML Kit 条款，不能因为示例代码采用 Apache 许可，就把模型视为可自由提取、转换及再分发的 ONNX 资产。[ML Kit 条款与隐私](https://developers.google.com/ml-kit/terms)

## ONNX：运行时可本地，模型本身仍需逐项审核

ONNX Runtime Web 可在浏览器进行本地推理，并提供 WASM 等执行路径；运行时的 MIT 许可不自动覆盖其加载的模型。模型、分词器、预处理与解码代码的来源、许可和缓存都要分别明确。离线也要求这些资源预先完整存在，而非临时去远端取模型。[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)、[运行时许可](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)

本次找到的具体候选为发布者维护的 `Xenova/trocr-small-handwritten` ONNX 转换。微软原始模型卡明确将 TrOCR 定位为单行图像 OCR，并说明在 IAM 上微调。它可以研究“把画布截图转文字”，但丢失笔画时间/顺序信息，不能称为在线数字墨迹识别。尚未测试其对 WriEng 孤立词、触摸写字、连笔和拼错词的效果。[微软模型卡](https://huggingface.co/microsoft/trocr-small-handwritten)、[ONNX 发布者模型卡](https://huggingface.co/Xenova/trocr-small-handwritten)

发布者文件页在本次核查时列出下列权重；全部只读取元数据，未下载模型：

| 权重组合示例 | 文件页显示大小 | 两项合计 |
| --- | --- | --- |
| `encoder_model_quantized.onnx` + `decoder_model_merged_quantized.onnx` | 23.1 MB + 40.5 MB | 约 63.6 MB |
| `encoder_model.onnx` + `decoder_model_merged.onnx` | 87.5 MB + 159 MB | 约 246.5 MB |

这是按文件页四舍五入值相加的权重规模示例，未确认该组合与选定运行时的完整兼容性；还不含运行时、tokenizer、配置、缓存及运行内存。`onnx` 目录显示的约 826 MB 包括多个精度和解码变体，不是每次推理都应下载全部文件。文件目录最新权重提交为 `9ef961fec33b56615026fbe77b9da68d6237cddb`；模型仓库后续 `2432e24d184b1d964d07ed04f5d9e21d31a59141` 更新的是模型卡元数据。[权重文件清单](https://huggingface.co/Xenova/trocr-small-handwritten/tree/main/onnx)、[权重提交](https://huggingface.co/Xenova/trocr-small-handwritten/commit/9ef961fec33b56615026fbe77b9da68d6237cddb)、[后续元数据提交](https://huggingface.co/Xenova/trocr-small-handwritten/commit/2432e24d184b1d964d07ed04f5d9e21d31a59141)

许可仍未达到随产品分发的审核标准：微软 TrOCR 项目指向 UniLM 根目录 MIT 许可，但本次读取的 ONNX 仓库模型卡没有显式 license 元数据，根文件列表也没有独立 LICENSE。不能把代码 MIT、网页上的 Safe 标记或可公开下载，直接等同转换权重已获完整再分发授权。训练数据 IAM 的原站本次无法读取，未完成其条款核实；本记录不据此推断训练数据条款是否传递至模型权重。应先澄清权重、转换与数据来源权限，固定修订和校验值，再申请下载/运行评估。[TrOCR 许可说明](https://github.com/microsoft/unilm/blob/master/trocr/README.md#license)、[UniLM 许可](https://github.com/microsoft/unilm/blob/master/LICENSE)、[转换模型卡元数据](https://huggingface.co/Xenova/trocr-small-handwritten/blob/main/README.md)、[仓库根文件列表](https://huggingface.co/Xenova/trocr-small-handwritten/tree/main)

在本次核查的来源内，尚未确认一个许可、下载资产和质量均已审定、可直接交付网页的英文**时序数字墨迹 ONNX 模型**。这不是断言此类模型不存在。当前不应引入未审核权重，也不应将图像 OCR、数字分类模型或笔画平滑库包装成已实现的英文笔画识别。

## 将来接入时必须保留的学习与隐私边界

以下为 WriEng 的实施建议，不是识别厂商提供的学习能力认证：

1. 收集真实有序笔画，并在需要时新增点的原始时间；当前归一化坐标与压力值不能凭空补成真实采样时间。Canvas PNG 可以用于图像路线，但不能恢复原笔画时序。
2. 在揭晓正确答案前，先让用户确认或修正识别候选；分别保留原始识别文案、用户确认文案、识别器/模型版本和原始提交时间。原笔迹仍默认仅在本次页面内存，不新增图片或点序列的持久化与上传。
3. 将“识别错了”和“我没记住/拼错了”分开记录。识别置信度衡量文字转换，不是学习掌握；识别器把文字转对，也不能自动给 Good。自评、提示、提前揭晓、首次回答及后续纠正证据都要保留。
4. 揭晓后的改正不覆盖首次提交，不能冒充首次独立正确。不要把当前标准答案偷偷作为识别约束，或把任意涂画强制映射到目标词，再宣称通过手写检验。
5. 识别失败、语言组件缺失、离线模型未就绪时，继续提供先写再对照自评和无障碍键入；页面应明确实际状态。
6. 原型验收应覆盖手指/笔/鼠标、连笔/印刷体、大小写、真实拼错、空白和涂画；测字符/词错误率、候选修正负担、失败率、延迟、内存及断网恢复，不编造准确率承诺。

研究与本轮代码验证：语音按钮已改为“整词慢速播放”，仅调整含义准确的文案，仍是整词 TTS 降速；对应组件测试 **10/10 通过**。未改动 App 学习流程，未接入或安装任何识别器。
