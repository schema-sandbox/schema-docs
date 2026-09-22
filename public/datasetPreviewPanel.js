const MAX_PREVIEW_ROWS = 20;

function columnName(column, index) {
  if (typeof column === "string" && column.trim()) return column;
  if (column?.name !== undefined && String(column.name).trim()) return String(column.name);
  return `Column ${index + 1}`;
}

function sheetIdentity(sheet, index) {
  return String(sheet?.sheetId ?? sheet?.name ?? index);
}

function previewColumns(sheet) {
  const columns = (sheet?.columns ?? []).map(columnName);
  const known = new Set(columns);
  for (const row of sheet?.previewRows ?? []) {
    if (!row || Array.isArray(row) || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        known.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function formatDatasetPreviewCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function createDatasetPreviewModel(dataset, { sheetId = "", maxRows = MAX_PREVIEW_ROWS } = {}) {
  const sheets = Array.isArray(dataset?.sheets) ? dataset.sheets : [];
  const requestedSheetId = String(sheetId || "");
  const selectedIndex = Math.max(0, sheets.findIndex((sheet, index) => sheetIdentity(sheet, index) === requestedSheetId));
  const selectedSheet = sheets[selectedIndex] ?? null;
  const selectedSheetId = selectedSheet ? sheetIdentity(selectedSheet, selectedIndex) : "";
  const columns = previewColumns(selectedSheet);
  const rowLimit = Math.min(MAX_PREVIEW_ROWS, Math.max(0, Number(maxRows) || MAX_PREVIEW_ROWS));
  const availableRows = Array.isArray(selectedSheet?.previewRows) ? selectedSheet.previewRows : [];
  const rows = availableRows.slice(0, rowLimit);
  const estimatedRows = Number(selectedSheet?.totalRowsEstimate);
  const totalRows = Number.isFinite(estimatedRows) && estimatedRows >= 0 ? estimatedRows : availableRows.length;

  return {
    datasetId: String(dataset?.id ?? ""),
    title: String(dataset?.name ?? dataset?.title ?? dataset?.id ?? "Dataset"),
    sheets: sheets.map((sheet, index) => ({
      id: sheetIdentity(sheet, index),
      name: String(sheet?.name ?? `Sheet ${index + 1}`),
      selected: index === selectedIndex
    })),
    selectedSheetId,
    selectedSheetName: String(selectedSheet?.name ?? ""),
    columns,
    rows,
    totalRows,
    shownRows: rows.length,
    emptyMessage: selectedSheet
      ? "This worksheet has no data rows to preview."
      : "This dataset contains no worksheets to preview."
  };
}

export function findReadyDataset(manifest, datasetId) {
  const dataset = (manifest?.datasets ?? []).find((candidate) => candidate.id === datasetId);
  if (!dataset) throw new Error(`Dataset ${datasetId} was not found after inspection.`);
  if (dataset.status !== "ready") {
    throw new Error(`Dataset ${dataset.name || dataset.id} is not ready after inspection (status: ${dataset.status || "unknown"}).`);
  }
  return dataset;
}

export function createDatasetPreviewPanel({ $, state }) {
  let currentDataset = null;

  const tr = (value) => window.translateText ? window.translateText(value) : value;

  function ensurePanelHost() {
    if ($("datasetPreview")) return;
    const workspaceGrid = document.querySelector(".grid");
    const documentFlowPanel = document.querySelector(".document-flow-panel");
    if (!workspaceGrid || !documentFlowPanel || documentFlowPanel.parentElement !== workspaceGrid) {
      throw new Error("Dataset preview cannot be attached to the main workspace.");
    }

    const host = document.createElement("section");
    host.id = "datasetPreview";
    host.className = "panel dataset-preview-panel dataset-preview hidden";
    host.tabIndex = -1;
    host.setAttribute("aria-labelledby", "datasetPreviewHeading");

    const headingRow = document.createElement("div");
    headingRow.className = "dataset-preview-heading";
    const headingCopy = document.createElement("div");
    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = "Spreadsheet preview";
    const heading = document.createElement("h3");
    heading.id = "datasetPreviewHeading";
    const title = document.createElement("span");
    title.id = "datasetPreviewTitle";
    title.textContent = "Dataset";
    heading.append(title);
    headingCopy.append(label, heading);
    const meta = document.createElement("div");
    meta.id = "datasetPreviewMeta";
    meta.className = "dataset-preview-meta";
    meta.setAttribute("aria-live", "polite");
    headingRow.append(headingCopy, meta);

    const sheets = document.createElement("div");
    sheets.id = "datasetPreviewSheets";
    sheets.className = "dataset-preview-sheets hidden";
    sheets.setAttribute("role", "tablist");
    sheets.setAttribute("aria-label", "Worksheets");
    const table = document.createElement("div");
    table.id = "datasetPreviewTable";
    table.className = "dataset-preview-table";
    table.setAttribute("aria-live", "polite");
    host.append(headingRow, sheets, table);

    documentFlowPanel.insertAdjacentElement("afterend", host);
  }

  ensurePanelHost();

  function render(dataset, { sheetId = "" } = {}) {
    currentDataset = dataset;
    const model = createDatasetPreviewModel(dataset, { sheetId, maxRows: MAX_PREVIEW_ROWS });
    state.selectedDatasetSheetId = model.selectedSheetId;

    const host = $("datasetPreview");
    $("datasetPreviewTitle").textContent = model.title;
    $("datasetPreviewMeta").textContent = model.selectedSheetName
      ? `${model.selectedSheetName} · ${model.shownRows}/${model.totalRows} ${tr("rows shown")} · ${model.columns.length} ${tr("columns")}`
      : tr(model.emptyMessage);

    const tabs = $("datasetPreviewSheets");
    tabs.replaceChildren();
    tabs.classList.toggle("hidden", model.sheets.length < 2);
    for (const sheet of model.sheets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `secondary dataset-preview-sheet${sheet.selected ? " active" : ""}`;
      button.textContent = sheet.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(sheet.selected));
      button.addEventListener("click", () => render(currentDataset, { sheetId: sheet.id }));
      tabs.append(button);
    }

    const tableHost = $("datasetPreviewTable");
    tableHost.replaceChildren();
    if (!model.rows.length || !model.columns.length) {
      const empty = document.createElement("p");
      empty.className = "dataset-preview-empty";
      empty.textContent = tr(model.emptyMessage);
      tableHost.append(empty);
    } else {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const heading = document.createElement("tr");
      for (const column of model.columns) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = column;
        heading.append(th);
      }
      thead.append(heading);
      table.append(thead);

      const tbody = document.createElement("tbody");
      for (const row of model.rows) {
        const trElement = document.createElement("tr");
        for (const column of model.columns) {
          const td = document.createElement("td");
          const value = Array.isArray(row) ? row[model.columns.indexOf(column)] : row?.[column];
          td.textContent = formatDatasetPreviewCell(value);
          td.title = td.textContent;
          trElement.append(td);
        }
        tbody.append(trElement);
      }
      table.append(tbody);
      tableHost.append(table);
    }

    host.classList.remove("hidden");
    return model;
  }

  async function revealDataset(dataset) {
    const model = render(dataset, { sheetId: state.selectedDatasetSheetId });
    const host = $("datasetPreview");
    host.scrollIntoView({ behavior: "smooth", block: "center" });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    host.focus({ preventScroll: true });
    return model;
  }

  function clear() {
    currentDataset = null;
    state.selectedDatasetSheetId = "";
    $("datasetPreview")?.classList.add("hidden");
  }

  return { clear, render, revealDataset };
}
