import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { importFileToWorkspace } from "../src/core/records.js";
import { inspectDatasetAsJob } from "../src/core/datasets.js";
import { csvImporter } from "../src/adapters/csvImporter.js";
import { createMemoryQueryEngine, parseSelectQuery, tableNameForDataset } from "../src/adapters/memoryQueryEngine.js";
import { listQueryTables, prepareQueryResultForAi, runQueryAsJob } from "../src/core/queries.js";
import { createAppService } from "../src/core/appService.js";
import { listEvidenceRecords } from "../src/core/evidence.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("parses simple select queries", () => {
  assert.deepEqual(parseSelectQuery("select * from sales limit 10"), {
    columns: ["*"],
    parsedColumns: [{ type: "field", field: "*", raw: "*", outputName: "*" }],
    tableName: "sales",
    limit: 10
  });
  assert.deepEqual(parseSelectQuery("select name, value from sales"), {
    columns: ["name", "value"],
    parsedColumns: [
      { type: "field", field: "name", raw: "name", outputName: "name" },
      { type: "field", field: "value", raw: "value", outputName: "value" }
    ],
    tableName: "sales",
    limit: undefined
  });
  assert.throws(() => parseSelectQuery("delete from sales"), { code: "query_unsupported" });
  assert.throws(() => parseSelectQuery("select * from sales unexpected"), { code: "query_unsupported" });
  assert.throws(() => parseSelectQuery("select * from sales where amount > 100 and region = 'US'"), { code: "query_unsupported" });
  assert.deepEqual(parseSelectQuery("select a.name, b.dept from a join b on a.id = b.id"), {
    columns: ["a.name", "b.dept"],
    parsedColumns: [
      { type: "field", field: "a.name", raw: "a.name", outputName: "a.name" },
      { type: "field", field: "b.dept", raw: "b.dept", outputName: "b.dept" }
    ],
    tableName: "a",
    limit: undefined,
    join: {
      tableName: "b",
      leftField: "a.id",
      rightField: "b.id"
    }
  });
  assert.equal(
    parseSelectQuery("select a.name from a inner join b on a.id = b.id").join.tableName,
    "b"
  );
});
test("runs simple memory query over inspected csv dataset", async () => {
  const workspace = await tempDir("lft-query-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "input.csv");
  await writeFile(csvPath, "name,value\nalpha,1\nbeta,2\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  const tableName = tableNameForDataset(dataset);
  const tables = await listQueryTables(workspace, createMemoryQueryEngine);
  const job = await runQueryAsJob(workspace, `select name,value from ${tableName} limit 1`, createMemoryQueryEngine);
  assert.equal(tables.length, 1);
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.output.rows, [{ name: "alpha", value: "1" }]);
});
test("queries every CSV row instead of silently stopping at the 500-row preview", async () => {
  const workspace = await tempDir("lft-query-full-csv-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const csvPath = path.join(workspace, "large-sales.csv");
  const rows = Array.from({ length: 650 }, (_, index) => `row-${index + 1},${index + 1}`);
  await writeFile(csvPath, ["name,amount", ...rows].join("\n"), "utf8");
  await service.importFile(csvPath);
  const tables = await service.listTables();
  assert.equal(tables[0].loadedRows, 500);
  assert.equal(tables[0].totalRows, 650);
  assert.equal(tables[0].isComplete, false);
  const queryJob = await service.runQuery("select count(*) as total, sum(amount) as amount_sum from large_sales");
  assert.equal(queryJob.status, "succeeded");
  assert.deepEqual(queryJob.output.rows, [{ total: 650, amount_sum: 211575 }]);
});
test("exposes and queries every worksheet in a workbook dataset", async () => {
  const datasets = [{
    id: "dataset-workbook-123456",
    name: "finance-book",
    sheets: [
      {
        sheetId: "1",
        name: "Sales",
        columns: [{ name: "region" }, { name: "amount" }],
        previewRows: [{ region: "East", amount: 10 }],
        totalRowsEstimate: 1
      },
      {
        sheetId: "2",
        name: "Budget 2026",
        columns: [{ name: "department" }, { name: "annual budget" }],
        previewRows: [{ department: "R&D", "annual budget": 500 }],
        totalRowsEstimate: 1
      }
    ]
  }];
  const engine = createMemoryQueryEngine(datasets);
  const tables = engine.listTables();
  assert.equal(tables.length, 2);
  assert.deepEqual(tables.map((table) => table.sheetName), ["Sales", "Budget 2026"]);
  assert.deepEqual(tables[1].queryColumns, [
    { source: "department", sql: "department" },
    { source: "annual budget", sql: "annual_budget" }
  ]);
  const result = await engine.run("select department,annual_budget from finance_book_budget_2026");
  assert.deepEqual(result.rows, [{ department: "R&D", annual_budget: 500 }]);
});
test("runs simple memory JOIN query over inspected csv datasets", async () => {
  const workspace = await tempDir("lft-query-join-");
  await openOrCreateWorkspace(workspace);
  const peoplePath = path.join(workspace, "people.csv");
  const departmentsPath = path.join(workspace, "departments.csv");
  await writeFile(peoplePath, "person_id,name,dept_id\n1,Alice,D1\n2,Bob,D2\n3,Carol,D1\n", "utf8");
  await writeFile(departmentsPath, "dept_id,dept_name\nD1,Research\nD2,Finance\n", "utf8");
  const peopleRecord = await importFileToWorkspace(workspace, peoplePath);
  const departmentsRecord = await importFileToWorkspace(workspace, departmentsPath);
  await inspectDatasetAsJob(workspace, peopleRecord.id, csvImporter);
  await inspectDatasetAsJob(workspace, departmentsRecord.id, csvImporter);
  const joinJob = await runQueryAsJob(
    workspace,
    "select people.name as name, departments.dept_name as department from people join departments on people.dept_id = departments.dept_id order by name asc",
    createMemoryQueryEngine
  );
  assert.equal(joinJob.status, "succeeded");
  assert.deepEqual(joinJob.output.columns, ["name", "department"]);
  assert.deepEqual(joinJob.output.rows, [
    { name: "Alice", department: "Research" },
    { name: "Bob", department: "Finance" },
    { name: "Carol", department: "Research" }
  ]);
  const queryContext = await prepareQueryResultForAi(
    workspace,
    "select people.name as name, departments.dept_name as department from people inner join departments on people.dept_id = departments.dept_id order by name asc",
    createMemoryQueryEngine
  );
  assert.equal(queryContext.queryShape.hasJoin, true);
  assert.equal(queryContext.queryShape.tableCount, 2);
  assert.equal(queryContext.queryShape.primaryTable, "people");
  assert.equal(queryContext.queryShape.joinedTable, "departments");
  const evidenceRecords = await listEvidenceRecords(workspace);
  const queryEvidence = evidenceRecords.find((record) => record.id === queryContext.evidenceId);
  assert.equal(queryEvidence.queryShape.hasJoin, true);
  assert.equal(queryEvidence.queryShape.hasOrderBy, true);
  assert.equal(JSON.stringify(queryEvidence).includes("select people.name"), false);
  assert.equal(JSON.stringify(queryEvidence).includes("Research"), false);
});
test("service import auto-inspects datasets and exposes stable table aliases", async () => {
  const workspace = await tempDir("lft-auto-inspect-alias-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const csvPath = path.join(workspace, "employee-data.csv");
  await writeFile(csvPath, "name,age\nAlice,30\nBob,35\n", "utf8");
  const record = await service.importFile(csvPath);
  assert.equal(record.kind, "dataset");
  assert.equal(record.autoInspectJob.status, "succeeded");
  const tables = await service.listTables();
  assert.equal(tables.length, 1);
  assert.ok(tables[0].tableName.startsWith("employee_data_"));
  assert.ok(tables[0].aliases.includes("employee_data"));
  const queryJob = await service.runQuery("select name,age from employee_data order by age desc");
  assert.equal(queryJob.status, "succeeded");
  assert.deepEqual(queryJob.output.rows, [
    { name: "Bob", age: "35" },
    { name: "Alice", age: "30" }
  ]);
  const queryContext = await service.prepareQueryForAi("select name,age from employee_data order by age desc");
  assert.equal(queryContext.rowCount, 2);
  assert.equal(queryContext.includedRowCount, 2);
  assert.equal(queryContext.truncatedRows, false);
  assert.ok(queryContext.evidenceId.startsWith("evidence_"));
  assert.match(queryContext.contextMarkdown, /Filtered Table Context For AI/);
  assert.match(queryContext.contextMarkdown, /select name,age from employee_data order by age desc/);
  assert.match(queryContext.contextMarkdown, /\| name \| age \|/);
  const queryHandoff = await service.saveQueryAiHandoffBundle(
    "notes/query-handoff.md",
    "select name,age from employee_data order by age desc",
    {
      input: {
        content: "caller supplied replacement content",
        evidenceId: "caller_supplied_evidence"
      }
    }
  );
  const queryHandoffMarkdown = await readFile(path.join(workspace, "notes", "query-handoff.md"), "utf8");
  assert.notEqual(queryHandoff.handoffBundle.evidenceId, "caller_supplied_evidence");
  assert.match(queryHandoffMarkdown, /Filtered Table Context For AI/);
  assert.match(queryHandoffMarkdown, /\| name \| age \|/);
  assert.equal(queryHandoffMarkdown.includes("caller supplied replacement content"), false);
  const evidenceRecords = await listEvidenceRecords(workspace);
  const queryEvidence = evidenceRecords.find((record) => record.id === queryContext.evidenceId);
  assert.equal(queryEvidence.kind, "ai_query_context_selected");
  assert.equal(queryEvidence.outputType, "ai_query_context");
  assert.equal(queryEvidence.aiSent, false);
  assert.equal(queryEvidence.storeRawPrompt, false);
  assert.equal(queryEvidence.queryShape.hasJoin, false);
  assert.equal(queryEvidence.queryShape.hasOrderBy, true);
  assert.equal(queryEvidence.queryShape.selectedColumnCount, 2);
  assert.equal(JSON.stringify(queryEvidence).includes("select name"), false);
  assert.equal(JSON.stringify(queryEvidence).includes("Alice"), false);
});
test("parses select queries with WHERE and ORDER BY", () => {
  assert.deepEqual(parseSelectQuery("select * from sales where amount > 100 order by date desc limit 5"), {
    columns: ["*"],
    parsedColumns: [{ type: "field", field: "*", raw: "*", outputName: "*" }],
    tableName: "sales",
    whereCondition: "amount > 100",
    orderByColumn: "date",
    orderByDirection: "desc",
    limit: 5
  });
});
test("parses select queries with GROUP BY and aggregates", () => {
  assert.deepEqual(parseSelectQuery("select dept, count(name), sum(salary), avg(age) from employees group by dept"), {
    columns: ["dept", "count(name)", "sum(salary)", "avg(age)"],
    parsedColumns: [
      { type: "field", field: "dept", raw: "dept", outputName: "dept" },
      { type: "count", field: "name", raw: "count(name)", outputName: "count(name)" },
      { type: "sum", field: "salary", raw: "sum(salary)", outputName: "sum(salary)" },
      { type: "avg", field: "age", raw: "avg(age)", outputName: "avg(age)" }
    ],
    tableName: "employees",
    groupByColumn: "dept",
    limit: undefined
  });
});
test("runs memory query with WHERE filter and ORDER BY sorting", async () => {
  const workspace = await tempDir("lft-query-ext-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "sales.csv");
  await writeFile(csvPath, "name,amount\nAlice,150\nBob,50\nCharlie,200\nA.C,75\nABC,80\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  const tableName = tableNameForDataset(dataset);
  const job1 = await runQueryAsJob(workspace, `select name,amount from ${tableName} where amount > 100`, createMemoryQueryEngine);
  assert.equal(job1.status, "succeeded");
  assert.equal(job1.output.rows.length, 2);
  const job1a = await runQueryAsJob(workspace, `select name,amount from ${tableName} where amount >= 150 order by amount asc`, createMemoryQueryEngine);
  assert.equal(job1a.status, "succeeded");
  assert.deepEqual(job1a.output.rows.map((row) => row.name), ["Alice", "Charlie"]);
  const job1b = await runQueryAsJob(workspace, `select name,amount from ${tableName} where amount <= 150 order by amount asc`, createMemoryQueryEngine);
  assert.equal(job1b.status, "succeeded");
  assert.deepEqual(job1b.output.rows.map((row) => row.name), ["Bob", "A.C", "ABC", "Alice"]);
  const job2 = await runQueryAsJob(workspace, `select name,amount from ${tableName} order by amount desc`, createMemoryQueryEngine);
  assert.equal(job2.status, "succeeded");
  assert.deepEqual(job2.output.rows, [
    { name: "Charlie", amount: "200" },
    { name: "Alice", amount: "150" },
    { name: "ABC", amount: "80" },
    { name: "A.C", amount: "75" },
    { name: "Bob", amount: "50" }
  ]);
  const job3 = await runQueryAsJob(workspace, `select name from ${tableName} where name like '%ch%'`, createMemoryQueryEngine);
  assert.equal(job3.status, "succeeded");
  assert.deepEqual(job3.output.rows, [
    { name: "Charlie" }
  ]);
  const job4 = await runQueryAsJob(workspace, `select name from ${tableName} where name like 'A.C'`, createMemoryQueryEngine);
  assert.equal(job4.status, "succeeded");
  assert.deepEqual(job4.output.rows, [
    { name: "A.C" }
  ]);
  const job5 = await runQueryAsJob(workspace, `select name from ${tableName} where name like 'A_C' order by name asc`, createMemoryQueryEngine);
  assert.equal(job5.status, "succeeded");
  assert.deepEqual(job5.output.rows, [
    { name: "A.C" },
    { name: "ABC" }
  ]);
});
test("runs memory query with GROUP BY and aggregate functions", async () => {
  const workspace = await tempDir("lft-query-groupby-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "employees.csv");
  await writeFile(csvPath, "name,dept,salary,age\nAlice,HR,5000,30\nBob,Eng,7000,25\nCharlie,HR,6000,40\nDavid,Eng,8000,35\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  const tableName = tableNameForDataset(dataset);
  const job = await runQueryAsJob(
    workspace,
    `select dept, count(name), sum(salary), avg(age) from ${tableName} group by dept order by dept asc`,
    createMemoryQueryEngine
  );
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.output.rows, [
    { dept: "Eng", "count(name)": 2, "sum(salary)": 15000, "avg(age)": 30 },
    { dept: "HR", "count(name)": 2, "sum(salary)": 11000, "avg(age)": 35 }
  ]);
  const aliasJob = await runQueryAsJob(
    workspace,
    `select dept, count(*) as 人数 from ${tableName} group by dept order by 人数 desc`,
    createMemoryQueryEngine
  );
  assert.equal(aliasJob.status, "succeeded");
  assert.deepEqual(aliasJob.output.columns, ["dept", "人数"]);
  assert.deepEqual(aliasJob.output.rows, [
    { dept: "HR", "人数": 2 },
    { dept: "Eng", "人数": 2 }
  ]);
});
test("runs memory query with multi-column GROUP BY and aggregated ORDER BY", async () => {
  const workspace = await tempDir("lft-query-multi-groupby-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "employees.csv");
  await writeFile(csvPath, "name,dept,salary,role\nAlice,HR,5000,Manager\nBob,Eng,7000,Developer\nCharlie,HR,6000,Manager\nDavid,Eng,8000,Developer\nEve,Eng,6000,Manager\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  const tableName = tableNameForDataset(dataset);
  const job = await runQueryAsJob(
    workspace,
    `select dept, role, count(name), sum(salary) from ${tableName} group by dept, role order by sum(salary) desc`,
    createMemoryQueryEngine
  );
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.output.rows, [
    { dept: "Eng", role: "Developer", "count(name)": 2, "sum(salary)": 15000 },
    { dept: "HR", role: "Manager", "count(name)": 2, "sum(salary)": 11000 },
    { dept: "Eng", role: "Manager", "count(name)": 1, "sum(salary)": 6000 }
  ]);
});
test("memory query aggregates MIN/MAX and rejects HAVING", async () => {
  const workspace = await tempDir("lft-query-minmax-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "employees.csv");
  await writeFile(csvPath, "name,dept,salary,role\nAlice,HR,5000,Manager\nBob,Eng,7000,Developer\nCharlie,HR,6000,Manager\nDavid,Eng,8000,Developer\nEve,Eng,6000,Manager\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  const tableName = tableNameForDataset(dataset);
  const job = await runQueryAsJob(
    workspace,
    `select dept, min(salary), max(salary) from ${tableName} group by dept`,
    createMemoryQueryEngine
  );
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.output.rows, [
    { dept: "HR", "min(salary)": 5000, "max(salary)": 6000 },
    { dept: "Eng", "min(salary)": 6000, "max(salary)": 8000 }
  ]);
  const badJob = await runQueryAsJob(workspace, `select dept from ${tableName} group by dept having sum(salary) > 1000`, createMemoryQueryEngine);
  assert.equal(badJob.status, "failed");
  assert.equal(badJob.error.code, "query_unsupported");
});
test("memory query engine executes LOWER(), UPPER() and SUBSTR() functions", async () => {
  const datasets = [
    {
      id: "ds-123456",
      name: "users",
      sheets: [
        {
          columns: [{ name: "name" }, { name: "email" }, { name: "role" }],
          previewRows: [
            { name: "Alice", email: "ALICE@EXAMPLE.COM", role: "Developer" },
            { name: "Bob", email: "Bob@Example.com", role: "Product Manager" }
          ]
        }
      ]
    }
  ];
  const engine = createMemoryQueryEngine(datasets);

  const res = await engine.run(
    "SELECT upper(name) as u_name, lower(email) as l_email, substr(role, 1, 7) as s_role FROM users"
  );
  assert.equal(res.rowCount, 2);
  assert.deepEqual(res.columns, ["u_name", "l_email", "s_role"]);
  assert.deepEqual(res.rows, [
    { u_name: "ALICE", l_email: "alice@example.com", s_role: "Develop" },
    { u_name: "BOB", l_email: "bob@example.com", s_role: "Product" }
  ]);

  const resSubNoLen = await engine.run(
    "SELECT substr(role, 9) as s_role_no_len FROM users"
  );
  assert.deepEqual(resSubNoLen.rows, [
    { s_role_no_len: "r" },
    { s_role_no_len: "Manager" }
  ]);

  const groupRes = await engine.run(
    "SELECT upper(role) as role_upper, count(name) as count_users FROM users GROUP BY role"
  );
  assert.equal(groupRes.rowCount, 2);
  assert.deepEqual(groupRes.rows, [
    { role_upper: "DEVELOPER", count_users: 1 },
    { role_upper: "PRODUCT MANAGER", count_users: 1 }
  ]);
});
test("memory query engine: ORDER BY with alias sorting", async () => {
  const datasets = [
    {
      id: "ds-1",
      name: "employees",
      sheets: [
        {
          columns: [{ name: "name" }, { name: "salary" }],
          previewRows: [
            { name: "Alice", salary: 5000 },
            { name: "Bob", salary: 7000 },
            { name: "Charlie", salary: 6000 }
          ]
        }
      ]
    }
  ];
  const engine = createMemoryQueryEngine(datasets);
  const result = await engine.run("SELECT name, salary as total_salary FROM employees ORDER BY total_salary DESC");
  assert.equal(result.rowCount, 3);
  assert.deepEqual(result.rows[0], { name: "Bob", total_salary: 7000 });
  assert.deepEqual(result.rows[1], { name: "Charlie", total_salary: 6000 });
  assert.deepEqual(result.rows[2], { name: "Alice", total_salary: 5000 });
});
test("memory query engine: JOIN columns with same name", async () => {
  const datasets = [
    {
      id: "ds-users",
      name: "users",
      sheets: [
        {
          columns: [{ name: "id" }, { name: "name" }],
          previewRows: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" }
          ]
        }
      ]
    },
    {
      id: "ds-orders",
      name: "orders",
      sheets: [
        {
          columns: [{ name: "id" }, { name: "user_id" }, { name: "name" }],
          previewRows: [
            { id: 101, user_id: 1, name: "Order A" },
            { id: 102, user_id: 2, name: "Order B" }
          ]
        }
      ]
    }
  ];
  const engine = createMemoryQueryEngine(datasets);
  const result = await engine.run("SELECT users.name as user_name, orders.name as order_name FROM users JOIN orders ON users.id = orders.user_id");
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.columns, ["user_name", "order_name"]);
  assert.deepEqual(result.rows[0], { user_name: "Alice", order_name: "Order A" });
  assert.deepEqual(result.rows[1], { user_name: "Bob", order_name: "Order B" });
});
test("prepareQueryResultForAi with GROUP BY multiple columns does not leak raw rows", async () => {
  const workspace = await tempDir("lft-query-evidence-privacy-");
  await openOrCreateWorkspace(workspace);
  const service = createAppService(workspace);
  await service.openWorkspace();
  const csvContent = "department,role,salary,name\nSales,Manager,5000,Alice\nSales,Developer,4000,Bob\nHR,Manager,4500,Charlie\n";
  await writeFile(path.join(workspace, "employees.csv"), csvContent, "utf8");
  await service.importFile(path.join(workspace, "employees.csv"));
  const queryContext = await service.prepareQueryForAi("SELECT department, role, sum(salary) as total FROM employees GROUP BY department, role");
  assert.equal(queryContext.rowCount, 3);
  const evidenceRecords = await listEvidenceRecords(workspace);
  const queryEvidence = evidenceRecords.find((record) => record.id === queryContext.evidenceId);
  assert.equal(queryEvidence.kind, "ai_query_context_selected");
  assert.equal(queryEvidence.outputType, "ai_query_context");
  assert.equal(queryEvidence.queryShape.hasGroupBy, true);

  const recordString = JSON.stringify(queryEvidence);
  assert.equal(recordString.includes("Alice"), false);
  assert.equal(recordString.includes("Bob"), false);
  assert.equal(recordString.includes("SELECT department"), false);
});
