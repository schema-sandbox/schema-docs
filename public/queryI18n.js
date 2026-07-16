const zhQueryLabels = new Map([
  ["Query result", "查询结果"],
  ["Last query", "最近查询"],
  ["rows", "行"],
  ["columns", "列"],
  ["More rows were not displayed", "还有更多行未显示"],
  [
    "The interface shows the first 200 rows. Export and AI handoff still use the query result.",
    "界面仅显示前 200 行；导出和 AI 交接仍使用完整查询结果。"
  ]
]);

export function translateQueryText(value) {
  return zhQueryLabels.get(value) || "";
}
