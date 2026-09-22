# TableFormer Fast 内部试验（2026-09-20）

## 决定

**完成了组件试验，暂不加入默认转换或安装包。** 简单中英文无框表有收益，但复杂表头、空格和数学表格出现结构错误，部署成本也超过现有预算。现有有线表格链路继续保留；这次试验不代表复杂表格能力已经交付。

这是对独立表格组件的本地调用，没有安装或对接整个 Docling 应用，也没有上传 G:\\test 材料。试验目录 `.ai-doc-exchange/model-trial/` 不进入发行包。

## 固定输入和来源

- 组件：`docling-ibm-models==4.0.3`；CPU PyTorch `2.8.0+cpu`、torchvision `0.23.0+cpu`、transformers `4.57.6`；完整实际版本和安装下载摘要保存在本地报告。
- 权重仓库：[Docling models 固定修订](https://huggingface.co/docling-project/docling-models/tree/2199320848bb9a8a519d22e4b528185a4f9a6f64)，目录 `model_artifacts/tableformer/fast`。
- 权重：145,453,276 字节，SHA-256 `3119563aab5a7c96fda4d621119b63fd8806272b86c30936d15507616422f718`。
- 配置：7,060 字节，SHA-256 `dca6762508dddfae6d57d6cb4ef822c6000119dff0f3b6489db7413118c2622a`。
- [组件代码](https://github.com/docling-project/docling-ibm-models)声明 MIT；该权重仓库的模型卡同时列出 CDLA-Permissive-2.0 / Apache-2.0。未找到该固定快照内按组件分配许可的完整文件，因此没有把模型卡标签当作最终分发许可闭包。两类许可与所有推理依赖均需随选定制品进一步明确。

`scripts/prepare-table-model-trial.py` 在推理前固定预期，生成 5 个独立表格、1 个普通段落反例，并从两份真实来源裁剪 4 个表格区域。真实源页先渲染核对，再写预期；教材页仅计单元格位置和跨度，不声称已确认全部数学文字。来源文件 SHA-256、物理页、区域坐标、图片 SHA-256 和文字框保存在 `samples/inputs.json`。

**本试验使用人工指定的表格区域，未测试自动表格定位。** 普通段落反例故意送入结构模型，用于验证它不能充当表格检测器。固定小集合和开发者视觉预期不等于独立人工盲测，也不补足原计划的 24 份分类样本验收。

## 结果

比较 `(行, 列, 行跨度, 列跨度)` 的完整集合；空单元格也计入预期。F1 是单元格拓扑集合的查准/查全综合值，不是文字正确率。规则基线调用产品的原生有线/对齐分支 `ruled_table_regions`，输入相同裁剪区域；不是整页流水线的端到端排名。

以下为坐标修正后的 v2 结果。初次试验遗漏 Campbell 页面原点 `(39,-39)`：图片裁剪正确，pdfplumber 的文字框和规则裁剪偏移。已在生成器中分开图片坐标与解析坐标，检查可见页面尺寸，重新生成全部输入并重新推理。10 张图片 SHA-256 均与原试验一致，未改预期结构；旧报告保留，但旧 Campbell 规则 F1=0.865、模型 F1=0.393 的比较失效。

| 样本 | 规则 F1 | 模型 F1 | 模型完整拓扑正确 | 第二次推理秒数 |
| --- | ---: | ---: | --- | ---: |
| 英文无框 5×4 | 0 | 1.000 | 是 | 1.098 |
| 无框合并表头 | 0 | 0.714 | 否，表头行错分 | 1.421 |
| 无框空单元格 | 0 | 0.947 | 否，丢掉 2 个空格 | 1.071 |
| 有线 5×4 对照 | 1.000 | 1.000 | 是 | 1.080 |
| 中文无框 5×4 | 0 | 1.000 | 是 | 1.089 |
| Bonanno 物理页 29，表体 5×5 | 1.000 | 1.000 | 是 | 1.319 |
| Bonanno 物理页 34，4×9 | 1.000 | 1.000 | 是 | 1.516 |
| Bonanno 物理页 581，上方 4×4 数学表 | 1.000 | 0.064 | 否，16 格被拆成 233 格 | 7.222 |
| Campbell 物理页 78，分组合计列 | 1.000 | 0.961 | 否，38 格输出为 39 格 | 2.332 |

9 个正例中模型完整拓扑匹配 5 个，原生规则匹配 5 个；两者失败类别不同，不能用合计数掩盖数学表格退步。强制输入的普通段落生成了 4 个单元格，规则没有生成表格。所有 10 个输入的两次模型响应一致。中文无框样本的原生文字框正确分配 20/20 格；这不是中文 OCR 准确率测试。

进一步定位：空格样本的模型原始 OTSL 序列包含 `ecel`，空格在文字匹配阶段消失；合并表头样本在原始序列阶段就已错分。两者需要不同修复，不能统一靠填空或重排行号掩盖。

## 资源成本

Windows 11 x64，Python 3.12.14，CPU 限 2 个推理线程，主机 12 个逻辑 CPU。最终报告为：

- 权重 **138.72 MiB**；模型加载（不含模块导入）约 **0.397 秒**。
- 推理进程峰值工作集 **702.12 MiB**，包含 Python、推理库与模型。
- 独立试验环境 **3,625,958,473 字节 / 27,402 文件（3.38 GiB）**，还未计权重；这是完整开发环境，不是经过裁剪的安装成本。
- 当前产品私有运行时仍为 **78,467,613 字节**，预算 **128 MiB**。仅此模型权重就超出该总预算，未调整预算来绕过问题。

## 实验复现与证据

1. 在开发目录创建独立 venv，从官方 CPU wheel 源安装上述 PyTorch / torchvision，再从 PyPI 安装固定组件与 `psutil==7.2.2`；不要装入 `runtime/`。本机精确依赖版本、下载 URL 和 wheel 哈希分别在 `model-trial/torch-install.json`、`models-install.json`，固定模型下载身份在 `model-receipt.json`。
2. 从上述固定模型修订下载两个指定文件。基准脚本在加载前检查权重及配置 SHA-256，且禁用 Hugging Face 在线下载。
3. 用具备 reportlab、pdfplumber、PDFium 的开发 Python 生成输入，再用试验 venv 运行：

```powershell
python -B -X utf8 scripts/prepare-table-model-trial.py --materials G:/test --output .ai-doc-exchange/audit/2026-09-20-table-grid/samples-v2
.ai-doc-exchange/model-trial/env/Scripts/python.exe -B -X utf8 scripts/benchmark-tableformer.py --inputs .ai-doc-exchange/audit/2026-09-20-table-grid/samples-v2/inputs.json --model-dir .ai-doc-exchange/model-trial/model/model_artifacts/tableformer/fast --output .ai-doc-exchange/audit/2026-09-20-table-grid/model-v2
```

生成器目前使用 Windows 宋体，字体摘要保存在输入清单；换字体或渲染版本需重新建立输入身份，不能混用结果。真实材料和裁剪图只留本地；仓库保留生成/测量代码，不分发用户教材。

修正后证据根目录：`.ai-doc-exchange/audit/2026-09-20-table-grid/`，输入为 `samples-v2/inputs.json`，原始模型输出及报告在 `model-v2/`。日志：`.ai-doc-exchange/logs/tableformer-v2.txt`。旧输入和结果仍在原 continuation 目录。

本轮自实现的保守无框表定位和完整网格，在相同输入上恢复了原来缺失的 4 类无框表；原生有线分支保持 5/5，合计 9/9，段落反例没有表格。这是开发小样本结构对照，不是通用质量验收。`scripts/evaluate-table-grids.py` 可用 `--inputs`、`--raw-results`、`--output` 重放该比较及原始 OTSL 网格，报告见 `replay-v2/results.json`。原始 OTSL 先建网格能恢复空格样本的 20 格，但无法纠正模型在序列阶段已经生成的错误结构；模型仍未默认启用。

## 后续实现的准入条件

1. 有线表和模型候选分开评分，可靠原生网格优先；不允许模型覆盖已证明正确的单元格结构。
2. 结构序列先建完整网格，再匹配原生/OCR 文字，显式保留空格和跨度；文字匹配不得重新决定网格拓扑。数学表、低一致性结果保留原图并要求复核。
3. 选定较小的模型或验证过的量化推理方式；必须比较导出前后结构一致性、CPU、峰值内存、安装增量及完整许可证。未验证的 ONNX 导出不能计作已解决部署。
4. 增加独立真实无框表和多级表头预期，同时验证自动区域定位。通过这些条件后才接入默认流水线；本轮没有把“能推理”当作“已达到高质量”。
