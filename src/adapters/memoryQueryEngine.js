import { AppError } from "../core/errors.js";
const WHERE_CONDITION_REGEX = /^\s*([a-zA-Z0-9_.\u4e00-\u9fa5]+)\s*(>=|<=|!=|=|>|<|like)\s*([\s\S]+?)\s*$/i;
function isSupportedWhereCondition(condition) {
const match = WHERE_CONDITION_REGEX.exec(condition);
if (!match) return false;
const value = match[3].trim();
return /^['"][\s\S]*['"]$/.test(value) || !/\s/.test(value);
}
function safeTableName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "table";
}
function safeColumnName(value) {
  let normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) normalized = "column";
  if (/^\d/.test(normalized)) normalized = `column_${normalized}`;
  return normalized;
}
function comparableFieldName(value) {
  const text = String(value ?? "");
  const separator = text.indexOf(".");
  if (separator < 0) return safeColumnName(text).toLowerCase();
  const table = text.slice(0, separator).toLowerCase();
  const column = text.slice(separator + 1);
  return `${table}.${safeColumnName(column).toLowerCase()}`;
}
export function tableNameForDataset(dataset) {
  return safeTableName(`${dataset.name}_${dataset.id.slice(-6)}`);
}
export function tableAliasesForDataset(dataset) {
  const aliases = [safeTableName(dataset.name)];
  return [...new Set(aliases.filter((alias) => alias && alias !== tableNameForDataset(dataset)))];
}
export function tableNameForSheet(dataset, sheet, index = 0) {
  if (index === 0) return tableNameForDataset(dataset);
  return safeTableName(`${dataset.name}_${sheet.name || sheet.sheetId || `sheet_${index + 1}`}_${dataset.id.slice(-6)}`);
}
function tableAliasesForSheet(dataset, sheet, index = 0) {
  const datasetAlias = safeTableName(dataset.name);
  const sheetAlias = safeTableName(sheet.name || sheet.sheetId || `sheet_${index + 1}`);
  const aliases = [
    `${datasetAlias}_${sheetAlias}`,
    sheetAlias,
    ...(index === 0 ? tableAliasesForDataset(dataset) : [])
  ];
  const canonicalName = tableNameForSheet(dataset, sheet, index);
  return [...new Set(aliases.filter((alias) => alias && alias !== canonicalName))];
}
function parseColumns(selectExpression) {
  if (selectExpression.trim() === "*") {
    return ["*"];
  }
  const result = [];
  let current = "";
  let parenDepth = 0;
  for (let i = 0; i < selectExpression.length; i++) {
    const char = selectExpression[i];
    if (char === "(") {
      parenDepth++;
    } else if (char === ")") {
      parenDepth--;
    }
    if (char === "," && parenDepth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result.filter(Boolean);
}
function parseJoinClause(remaining, sql) {
  const joinMatch = /^(?:inner\s+)?join\s+([a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_.\u4e00-\u9fa5]+)\s*=\s*([a-zA-Z0-9_.\u4e00-\u9fa5]+)([\s\S]*)$/i.exec(remaining);
  if (joinMatch) return {
      join: {
        tableName: joinMatch[1],
        leftField: joinMatch[2].trim(),
        rightField: joinMatch[3].trim()
      },
      remaining: joinMatch[4].trim()
    };
  if (/^join\b/i.test(remaining) || /\bjoin\b/i.test(sql)) {
    throw new AppError("query_unsupported", "Only simple INNER JOIN...", {
      sql
    });
  }
  return { join: undefined, remaining };
}
function parseSelectedColumn(col) {
  const aliasMatch = /^([\s\S]+?)\s+as\s+([^\s,]+)$/i.exec(col);
  const expression = aliasMatch ? aliasMatch[1].trim() : col;
  const outputName = aliasMatch ? aliasMatch[2].trim() : col;
  const fnMatch = /^(count|sum|avg|min|max|lower|upper)\((.+?)\)$/i.exec(expression);
  if (fnMatch) return { type: fnMatch[1].toLowerCase(), field: fnMatch[2].trim(), raw: expression, outputName };
  const substrMatch = /^substr\((.+?),\s*(\d+)(?:,\s*(\d+))?\)$/i.exec(expression);
  if (substrMatch) return {
      type: "substr",
      field: substrMatch[1].trim(),
      start: parseInt(substrMatch[2], 10),
      length: substrMatch[3] ? parseInt(substrMatch[3], 10) : undefined,
      raw: expression,
      outputName
    };
  return { type: "field", field: expression, raw: expression, outputName };
}
export function parseSelectQuery(sql) {
  const normalized = sql.trim().replace(/;$/, "");
  if (/\bhaving\b/i.test(normalized)) {
    throw new AppError("query_unsupported", "HAVING is not supporte...", {
      sql
    });
  }
  const selectFromMatch = /^select\s+(.+?)\s+from\s+([a-zA-Z0-9_]+)/i.exec(normalized);
  if (!selectFromMatch) throw new AppError("query_unsupported", "Only SELECT ... FROM ....", {
      sql
    });
  const columns = parseColumns(selectFromMatch[1]);
  if (columns.length === 0) throw new AppError("query_no_columns", "Query must select at l...", {
      sql
    });
  const tableName = selectFromMatch[2];
  const joinParse = parseJoinClause(normalized.slice(selectFromMatch[0].length).trim(), normalized);
  const remaining = joinParse.remaining;
  let whereCondition;
  const whereMatch = /^where\s+([\s\S]+?)(?=\s+group\s+by|\s+order\s+by|\s+limit|$)/i.exec(remaining);
  if (whereMatch) {
    whereCondition = whereMatch[1].trim();
  }
  let groupByColumn;
  const groupByMatch = /group\s+by\s+([\s\S]+?)(?=\s+order\s+by|\s+limit|$)/i.exec(remaining);
  if (groupByMatch) {
    groupByColumn = groupByMatch[1].trim();
  }
  let orderByColumn;
  let orderByDirection = "asc";
  const orderByMatch = /order\s+by\s+([\s\S]+?)(?:\s+(asc|desc))?(?=\s+limit|$)/i.exec(remaining);
  if (orderByMatch) {
    orderByColumn = orderByMatch[1].trim();
    orderByDirection = (orderByMatch[2] ?? "asc").toLowerCase();
  }
  let limit;
  const limitMatch = /limit\s+(\d+)/i.exec(remaining);
  if (limitMatch) {
    limit = Number(limitMatch[1]);
  }
  const unsupportedRemainder = [whereMatch?.[0], groupByMatch?.[0], orderByMatch?.[0], limitMatch?.[0]]
    .filter(Boolean)
    .reduce((text, matched) => text.replace(matched, ""), remaining)
    .trim();
  if (unsupportedRemainder) throw new AppError("query_unsupported", `Unsupported SQL clause: ${unsupportedRemainder}`, {
      sql
    });
  if (whereCondition && !isSupportedWhereCondition(whereCondition)) {
    throw new AppError("query_unsupported", "Only simple WHERE comp...", {
      sql,
      whereCondition
    });
  }
  const parsedColumns = columns.map(parseSelectedColumn);
  const result = {
    columns,
    parsedColumns,
    tableName,
    limit
  };
  if (joinParse.join) {
    result.join = joinParse.join;
  }
  if (whereCondition !== undefined) {
    result.whereCondition = whereCondition;
  }
  if (groupByColumn !== undefined) {
    result.groupByColumn = groupByColumn;
  }
  if (orderByColumn !== undefined) {
    result.orderByColumn = orderByColumn;
    result.orderByDirection = orderByDirection;
  }
  return result;
}
function resolveFieldValue(row, field) {
  if (row[field] !== undefined) return row[field];
  const comparable = comparableFieldName(field);
  const matchingKey = Object.keys(row).find((key) => comparableFieldName(key) === comparable);
  if (matchingKey !== undefined) return row[matchingKey];
  if (field.includes(".")) {
    const unqualified = field.split(".").pop();
    if (row[unqualified] !== undefined) return row[unqualified];
    const unqualifiedComparable = comparableFieldName(unqualified);
    const unqualifiedKey = Object.keys(row).find((key) => {
      const keyColumn = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
      return comparableFieldName(keyColumn) === unqualifiedComparable;
    });
    return unqualifiedKey === undefined ? undefined : row[unqualifiedKey];
  }
  return undefined;
}
function evaluateSelectedColumn(row, col) {
  const rawVal = resolveFieldValue(row, col.field);
  if (rawVal === undefined || rawVal === null) return "";
  const strVal = String(rawVal);
  if (col.type === "lower") return strVal.toLowerCase();
  if (col.type === "upper") return strVal.toUpperCase();
  if (col.type === "substr") {
    const start = col.start - 1;
    if (col.length !== undefined) return strVal.slice(start, start + col.length);
    return strVal.slice(start);
  }
  return rawVal;
}
function evaluateCondition(row, whereCondition) {
  if (!whereCondition) return true;
  const condMatch = WHERE_CONDITION_REGEX.exec(whereCondition);
  if (!condMatch) return false;
  const field = condMatch[1];
  const operator = condMatch[2].toLowerCase();
  let value = condMatch[3].trim();
  if (/^['"][\s\S]*['"]$/.test(value)) {
    value = value.slice(1, -1);
  }
  const rowValue = resolveFieldValue(row, field);
  if (rowValue === undefined) return false;
  const isNumComparison = !isNaN(Number(rowValue)) && !isNaN(Number(value)) && rowValue !== "" && value !== "";
  const valA = isNumComparison ? Number(rowValue) : String(rowValue).toLowerCase();
  const valB = isNumComparison ? Number(value) : String(value).toLowerCase();
  switch (operator) {
    case "=":
      return valA === valB;
    case "!=":
      return valA !== valB;
    case ">":
      return valA > valB;
    case "<":
      return valA < valB;
    case ">=":
      return valA >= valB;
    case "<=":
      return valA <= valB;
    case "like": {
      const pattern = String(value).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(String(rowValue).toLowerCase());
    }
    default:
      return false;
  }
}
function tableNamesForQualifying(table) {
  return [...new Set([table.tableName, table.canonicalTableName, ...(table.aliases ?? [])].filter(Boolean))];
}
function qualifyRows(table) {
  const names = tableNamesForQualifying(table);
  return table.rows.map((row) => {
    const qualified = {};
    for (const column of table.columns) {
      const value = row[column];
      if (qualified[column] === undefined) {
        qualified[column] = value;
      }
      for (const name of names) {
        qualified[`${name}.${column}`] = value;
      }
    }
    return qualified;
  });
}
function joinRows(leftTable, rightTable, join) {
  const leftRows = qualifyRows(leftTable);
  const rightRows = qualifyRows(rightTable);
  const rows = [];
  for (const leftRow of leftRows) {
    const leftValue = resolveFieldValue(leftRow, join.leftField);
    for (const rightRow of rightRows) {
      const rightValue = resolveFieldValue(rightRow, join.rightField);
      if (String(leftValue ?? "") !== String(rightValue ?? "")) {
        continue;
      }
      const merged = { ...leftRow };
      for (const [key, value] of Object.entries(rightRow)) {
        if (merged[key] === undefined || key.includes(".")) {
          merged[key] = value;
        }
      }
      rows.push(merged);
    }
  }
  return rows;
}
function availableColumnsForTables(table, joinTable) {
  if (!joinTable) return table.columns;
  return [
    ...tableNamesForQualifying(table).flatMap((name) => table.columns.map((column) => `${name}.${column}`)),
    ...tableNamesForQualifying(joinTable).flatMap((name) => joinTable.columns.map((column) => `${name}.${column}`)),
    ...new Set([...table.columns, ...joinTable.columns])
  ];
}
function columnExists(column, availableColumns) {
  const comparable = comparableFieldName(column);
  const unqualified = comparableFieldName(column.split(".").pop());
  return availableColumns.some((available) => {
    const comparableAvailable = comparableFieldName(available);
    const unqualifiedAvailable = comparableFieldName(available.split(".").pop());
    return comparableAvailable === comparable || unqualifiedAvailable === unqualified;
  });
}
function aggregateValue(type, field, groupRows) {
  if (type === "count") {
    if (field === "*" || field === "1") return groupRows.length;
    return groupRows.filter((row) => {
      const value = resolveFieldValue(row, field);
      return value !== undefined && value !== null && value !== "";
    }).length;
  }
  if (type === "sum") {
    return groupRows.reduce((acc, row) => {
      const value = Number(resolveFieldValue(row, field));
      return acc + (isNaN(value) ? 0 : value);
    }, 0);
  }
  if (type === "avg") {
    const nums = groupRows.map((row) => Number(resolveFieldValue(row, field))).filter((value) => !isNaN(value));
    return nums.length > 0 ? nums.reduce((acc, value) => acc + value, 0) / nums.length : 0;
  }
  if (type === "min" || type === "max") {
    const nums = groupRows.map((row) => Number(resolveFieldValue(row, field))).filter((value) => !isNaN(value));
    if (nums.length > 0) return type === "min" ? Math.min(...nums) : Math.max(...nums);
    const vals = groupRows.map((row) => resolveFieldValue(row, field)).filter((value) => value !== undefined && value !== null && value !== "");
    if (vals.length === 0) return "";
    const sorted = vals.sort();
    return type === "min" ? sorted[0] : sorted.reverse()[0];
  }
  return "";
}
export function createMemoryQueryEngine(datasets) {
  const tables = new Map();
  for (const dataset of datasets) {
    for (const [sheetIndex, sheet] of (dataset.sheets ?? []).entries()) {
      const tableName = tableNameForSheet(dataset, sheet, sheetIndex);
      const table = {
        tableName,
        datasetId: dataset.id,
        sheetId: sheet.sheetId,
        sheetName: sheet.name || sheet.sheetId || `Sheet ${sheetIndex + 1}`,
        aliases: tableAliasesForSheet(dataset, sheet, sheetIndex),
        columns: (sheet.columns ?? []).map((column) => column.name),
        rows: sheet.previewRows ?? [],
        totalRows: sheet.totalRowsEstimate ?? sheet.previewRows?.length ?? 0
      };
      tables.set(tableName, table);
      for (const alias of table.aliases) {
        if (!tables.has(alias)) {
          tables.set(alias, { ...table, tableName: alias, canonicalTableName: tableName });
        }
      }
    }
  }
  return {
    name: "memory-query-engine",
    listTables() {
      return Array.from(tables.values())
        .filter((table) => !table.canonicalTableName)
        .map((table) => ({
          tableName: table.tableName,
          datasetId: table.datasetId,
          sheetId: table.sheetId,
          sheetName: table.sheetName,
          aliases: table.aliases,
          columns: table.columns,
          queryColumns: table.columns.map((column) => ({
            source: column,
            sql: safeColumnName(column)
          })),
          previewRows: table.rows.length,
          loadedRows: table.rows.length,
          totalRows: table.totalRows,
          isComplete: table.rows.length >= table.totalRows
        }));
    },
    datasetIdsForTables(tableNames = []) {
      return [...new Set(tableNames.map((tableName) => tables.get(tableName)?.datasetId).filter(Boolean))];
    },
    async run(sql, options = {}) {
      const parsed = parseSelectQuery(sql);
      const table = tables.get(parsed.tableName);
      if (!table) throw new AppError("query_table_not_found", `Table not found: ${parsed.tableName}`, {
          tableName: parsed.tableName,
          availableTables: Array.from(tables.keys())
        });
      const joinTable = parsed.join ? tables.get(parsed.join.tableName) : null;
      if (parsed.join && !joinTable) throw new AppError("query_table_not_found", `Table not found: ${parsed.join.tableName}`, {
          tableName: parsed.join.tableName,
          availableTables: Array.from(tables.keys())
        });
      const sourceColumns = availableColumnsForTables(table, joinTable);
      const sourceRows = parsed.join ? joinRows(table, joinTable, parsed.join) : table.rows;
      const isWildcard = parsed.columns.includes("*");
      if (!isWildcard) {
        const columnsToCheck = parsed.parsedColumns
          .map((column) => column.field)
          .filter((column) => column !== "*" && column !== "1");
        const unknownColumns = columnsToCheck.filter((column) => !columnExists(column, sourceColumns));
        if (unknownColumns.length > 0) throw new AppError("query_column_not_found", `Unknown column: ${unknownColumns[0]}`, {
            unknownColumns,
            availableColumns: sourceColumns
          });
      }
      const selectedColumns = isWildcard ? sourceColumns : parsed.parsedColumns.map((column) => column.outputName);
      const filteredRows = sourceRows.filter((row) => evaluateCondition(row, parsed.whereCondition));
      let groupedResults = [];
      const hasAggregates = parsed.parsedColumns.some((column) =>
        ["count", "sum", "avg", "min", "max"].includes(column.type)
      );
      if (parsed.groupByColumn || hasAggregates) {
        const groupColumns = parsed.groupByColumn
          ? parsed.groupByColumn.split(",").map((col) => col.trim()).filter(Boolean)
          : [];
        const groups = new Map();
        for (const row of filteredRows) {
          const groupKey = groupColumns.length > 0
            ? groupColumns.map((column) => String(resolveFieldValue(row, column) ?? "")).join(" | ")
            : "";
          if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
          }
          groups.get(groupKey).push(row);
        }
        for (const groupRows of groups.values()) {
          const outputRow = {};
          for (const col of parsed.parsedColumns) {
            if (col.type === "field") {
              outputRow[col.outputName] = resolveFieldValue(groupRows[0] ?? {}, col.field) ?? "";
            } else if (col.type === "lower" || col.type === "upper" || col.type === "substr") {
              outputRow[col.outputName] = evaluateSelectedColumn(groupRows[0] ?? {}, col);
            } else {
              outputRow[col.outputName] = aggregateValue(col.type, col.field, groupRows);
            }
          }
          groupedResults.push(outputRow);
        }
      } else {
        groupedResults = filteredRows.map((row) => {
          if (isWildcard) return Object.fromEntries(selectedColumns.map((column) => [column, resolveFieldValue(row, column)]));
          return Object.fromEntries(parsed.parsedColumns.map((column) => [column.outputName, evaluateSelectedColumn(row, column)]));
        });
      }
      if (parsed.orderByColumn) {
        const orderBy = parsed.orderByColumn.toLowerCase();
        const col = parsed.parsedColumns.find((column) =>
          column.raw.toLowerCase() === orderBy || column.outputName.toLowerCase() === orderBy
        )?.outputName ?? parsed.orderByColumn;
        const dir = parsed.orderByDirection === "desc" ? -1 : 1;
        groupedResults.sort((a, b) => {
          const valA = resolveFieldValue(a, col);
          const valB = resolveFieldValue(b, col);
          if (valA === undefined || valB === undefined) return 0;
          const numA = Number(valA);
          const numB = Number(valB);
          if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") {
            return (numA - numB) * dir;
          }
          return String(valA).localeCompare(String(valB)) * dir;
        });
      }
      const limit = Math.min(parsed.limit ?? options.limit ?? 500, options.maxLimit ?? 1000);
      const rows = groupedResults.slice(0, limit);
      return {
        columns: selectedColumns,
        rows,
        rowCount: rows.length,
        truncated: groupedResults.length > rows.length
      };
    }
  };
}
