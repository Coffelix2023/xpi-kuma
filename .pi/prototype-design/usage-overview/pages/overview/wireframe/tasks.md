- [x] 1.1 生成 5 屏骨架 (验收:HTML 结构完整、语义区块占位符就位、style/script 空标签存在;产出:current/screens/01-overview.html…05-insight-na.html)
  验证: grep 计数 5 文件 blocks=13/11、<style>=1、<script>=1、id="overview.*"≥8，结构与占位符就位 · 2026-09-22
- [x] 1.2 填充 CSS tokens 与全局灰阶样式 (验收:四基础 token 定义、暗色默认、断点 <800px 就绪;产出:current/screens/*.html)
  验证: grep 5 文件 --background×3、max-width:800px×1、style/head 标签各 1、无外部请求 · 2026-09-22
- [x] 1.3 填充 01-overview 主态 (验收:时间范围/五指标/趋势/三排行/建议卡片按已定层级全部就位;产出:current/screens/01-overview.html)
  验证: grep section 6开6闭、nav/table/article 配对、15 个 overview.* id 按 指标→趋势→排行→效率→建议 排序、无占位残留 · 2026-09-22
- [x] 1.4 填充 02-empty 无数据态 (验收:总览显零值或暂无数据+路径引导，不渲染误导行;产出:current/screens/02-empty.html)
  验证: 占位注释 0、section 7开7闭、仅 ¥0.00 无非零值、缓存率=未知非0%、引导文案在位 · 2026-09-22
- [x] 1.5 填充 03-latency-na 延迟不可用态 (验收:效率区显暂无真实数据，不用 probe/估算替代;产出:current/screens/03-latency-na.html)
  验证: 占位注释 0、section 6/6、效率区=p placeholder 无 p50 数值行、建议区 cost+cache 在、efficiency 卡缺省 · 2026-09-22
- [x] 1.6 填充 04-low-sample 样本不足态 (验收:<10 样本组合标注数据不足且不进最佳建议;产出:current/screens/04-low-sample.html)
  验证: 占位注释 0、section 6/6、数据不足行 2、low-sample-note 在位、建议区无最佳结论 · 2026-09-22
- [x] 1.7 填充 05-insight-na 建议不可用态 (验收:建议区显不可用+基础统计保留;产出:current/screens/05-insight-na.html)
  验证: 占位注释 0、section 6/6、insight-unavailable 1、基础统计在位、HTML 建议卡 0 · 2026-09-22
- [x] 1.8 响应式与线框规范自检 (验收:<800px 堆叠可读、每块带 data-wireframe-block/priority、占位文案中文 12–20 字、无外部请求;产出:自检记录)
  验证: 5 文件 block=priority 计数相等、断点+堆叠规则齐、tabs=4/active=1、id 无重复、无硬编码色、无外部请求、文案长度达标 · 2026-09-22
- [x] 1.9 登记语义字典并标注徽标 (验收:semantic_ui_map_validate=valid、annotate 完成或报告跳过;产出:semantic-ui-map.yaml)
  验证: validate 0 问题码；annotate 命中 5 文件（01=15 处徽标，态文件各 1 处）；fidelities 已指 pages/overview/wireframe/current/screens/* · 2026-09-22
- [x] 1.10 按第一轮评审返工：对齐成品壳与主次 (验收:4标签壳+range前置、总览面板 P0→P1→P2、趋势入趋势标签、降噪无满边框、5屏同壳;产出:current/screens/*.html)
  验证: 5 文件 range<tablist、tabs=4/panels=4/hidden=3、block=priority 成对、id 无重复、无外部请求/硬编码色、section 无满边框；状态要素 03/04/05/02 各在位 · 2026-09-22
