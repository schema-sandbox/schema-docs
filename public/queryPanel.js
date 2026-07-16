import { translateQueryText } from "./queryI18n.js";

export function createQueryPanel({
  $, api, state, run, refreshManifest, timestampForPath, aiContextPanel
}) {
  const tr = (value) => {
    if (document.body.dataset.uiLanguage !== "zh-CN") return value;
    return translateQueryText(value) || (window.translateText ? window.translateText(value) : value);
  };

  function ensurePanelHosts() {
    if (!$("queryTables")) {
      const tableHost = document.createElement("div");
      tableHost.id = "queryTables";
      tableHost.className = "query-table-list hidden";
      $("listTables").insertAdjacentElement("afterend", tableHost);
    }
    if (!$("queryResult")) {
      const resultHost = document.createElement("div");
      resultHost.id = "queryResult";
      resultHost.className = "query-result hidden";
      resultHost.setAttribute("aria-live", "polite");
      $("lastQuery").insertAdjacentElement("afterend", resultHost);
    }
  }

  function preferredTableName(table) {
    return [...(table.aliases ?? [])]
      .filter((alias) => alias && !/[a-f0-9]{6}$/i.test(alias))
      .sort((left, right) => left.length - right.length)[0] || table.tableName;
  }

  function formatCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
    }
    return String(value);
  }

  function renderQueryResult(result) {
    const host = $("queryResult");
    host.replaceChildren();
    if (!result?.columns?.length) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    const meta = document.createElement("div");
    meta.className = "query-result-meta";
    meta.textContent = `${tr("Query result")}: ${result.rows.length} ${tr("rows")}${result.truncated ? ` · ${tr("More rows were not displayed")}` : ""}`;
    host.append(meta);
    const scroller = document.createElement("div");
    scroller.className = "query-result-scroll";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of result.columns) {
      const th = document.createElement("th");
      th.textContent = column;
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    const visibleRows = result.rows.slice(0, 200);
    for (const row of visibleRows) {
      const trElement = document.createElement("tr");
      for (const column of result.columns) {
        const td = document.createElement("td");
        const raw = row?.[column];
        td.textContent = formatCell(raw);
        td.title = raw === null || raw === undefined ? "" : String(raw);
        trElement.append(td);
      }
      tbody.append(trElement);
    }
    table.append(tbody);
    scroller.append(table);
    host.append(scroller);
    if (result.rows.length > visibleRows.length) {
      const note = document.createElement("p");
      note.className = "sub-text query-result-note";
      note.textContent = tr("The interface shows the first 200 rows. Export and AI handoff still use the query result.");
      host.append(note);
    }
  }

  function renderTables(tables) {
    state.queryTables = tables;
    const host = $("queryTables");
    host.replaceChildren();
    host.classList.toggle("hidden", !tables.length);
    for (const table of tables) {
      const alias = preferredTableName(table);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "query-table-row";
      const heading = document.createElement("span");
      heading.className = "query-table-heading";
      const name = document.createElement("strong");
      name.textContent = table.sheetName || table.tableName;
      const stats = document.createElement("small");
      stats.textContent = `${table.totalRows} ${tr("rows")} · ${table.columns.length} ${tr("columns")}`;
      heading.append(name, stats);
      const tableCode = document.createElement("code");
      tableCode.textContent = alias;
      const fields = document.createElement("span");
      fields.className = "query-table-fields";
      fields.textContent = (table.queryColumns ?? []).map(({ source, sql }) => source === sql ? sql : `${source} → ${sql}`).join(" · ");
      row.append(heading, tableCode, fields);
      row.addEventListener("click", () => {
        $("sqlInput").value = `select * from ${alias} limit 20`;
        $("sqlInput").focus();
      });
      host.append(row);
    }
  }

  function rememberQueryResult(job) {
    if (job?.output?.columns && job?.output?.rows) {
      state.lastQueryResult = job.output;
      $("lastQuery").textContent = `${tr("Last query")}: ${job.output.rows.length} ${tr("rows")}`;
      renderQueryResult(job.output);
    }
    return job;
  }

  async function loadQueryResultForAi() {
    const sql = $("sqlInput").value.trim();
    if (!sql) throw new Error("Enter a SQL query first.");
    const context = await api("/api/ai/query-context", { sql, options: { maxRows: 50 } });
    state.lastQueryResult = { columns: context.columns, rows: context.rows };
    $("aiOperation").value = "explain_table";
    $("aiContent").value = context.contextMarkdown;
    $("lastQuery").textContent = `Filtered AI table context: ${context.includedRowCount}/${context.rowCount} rows`;
    $("sendGateSummary").textContent = [
      "Filtered table context loaded for AI", `tokens~${context.tokenEstimate}`,
      context.truncatedRows ? "truncated to 50 rows" : "complete result", "review required before send"
    ].join(" | ");
    state.lastReviewedAiContextSignature = "";
    state.stagedAiContextDirty = true;
    aiContextPanel.renderAiChunkLedger();
    $("aiContent").focus();
    return context;
  }

  async function saveQueryHandoffForAi() {
    const sql = $("sqlInput").value.trim();
    if (!sql) throw new Error("Enter a SQL query first.");
    const relativePath = `notes/query-ai-handoff-${timestampForPath()}.md`;
    const saved = await api("/api/ai/query-handoff", {
      relativePath, sql,
      options: { queryOptions: { maxRows: 50 }, input: { source: "web-ui-query-ai-handoff" } }
    });
    $("notePath").value = relativePath;
    $("noteContent").value = saved.handoffBundle.body || "Filtered table handoff bundle saved through the local API.";
    $("lastQuery").textContent = `Saved filtered table handoff: ${saved.queryContext.includedRowCount}/${saved.queryContext.rowCount} rows`;
    $("sendGateSummary").textContent = [
      `Saved filtered table handoff: ${relativePath}`, `tokens~${saved.queryContext.tokenEstimate}`,
      `evidence: ${saved.handoffBundle.evidenceId || "none"}`
    ].join(" | ");
    await refreshManifest();
    return saved;
  }

  async function loadTables() {
    const tables = await api("/api/tables");
    renderTables(tables);
    if (tables[0] && !$("sqlInput").value.trim()) {
      $("sqlInput").value = `select * from ${preferredTableName(tables[0])} limit 20`;
    }
    return tables;
  }

  function bindQueryPanelEvents() {
    ensurePanelHosts();
    $("listTables").addEventListener("click", () => run(loadTables));
    $("sqlTemplates").addEventListener("change", () => run(async () => {
      const template = $("sqlTemplates").value;
      if (!template) return;
      const tables = state.queryTables?.length ? state.queryTables : await loadTables();
      const table = tables[0];
      const queryColumns = table?.queryColumns ?? [];
      const tableName = table ? preferredTableName(table) : "employees_xxxxxx";
      const colName = queryColumns[0]?.sql || "dept";
      const numColName = queryColumns.find(({ source }) => /salary|age|amount|count|size|price|id|\u6570\u91cf|\u91d1\u989d|\u4ef7\u683c/i.test(source))?.sql
        || queryColumns[1]?.sql || colName;
      $("sqlInput").value = template.replace(/{table}/g, tableName).replace(/{col}/g, colName).replace(/{num_col}/g, numColName);
    }));
    $("runQuery").addEventListener("click", () => run(async () => {
      const job = await api("/api/query", { sql: $("sqlInput").value });
      return rememberQueryResult(job);
    }));
    $("loadQueryForAi").addEventListener("click", () => run(loadQueryResultForAi));
    $("saveQueryHandoff").addEventListener("click", () => run(saveQueryHandoffForAi));
  }

  return { bindQueryPanelEvents, rememberQueryResult, loadQueryResultForAi, saveQueryHandoffForAi };
}
