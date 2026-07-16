import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const planPath = path.resolve(root, argValue("--plan", "samples/fixture-plan.json"));
const resultsPath = path.resolve(root, argValue("--results", "samples/fixture-results.json"));
const strict = process.argv.includes("--strict");
const allowedStatuses = new Set(["planned", "pass", "known_limit", "fail", "blocked"]);
const passingStatuses = new Set(["pass", "known_limit"]);

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? "missing";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(code, detail) {
  return { code, detail };
}

const plan = JSON.parse(await readFile(planPath, "utf8"));
let resultFile = {};
let resultRecords = [];
try {
  resultFile = JSON.parse(await readFile(resultsPath, "utf8"));
  resultRecords = Array.isArray(resultFile.results) ? resultFile.results : [];
} catch {
  resultFile = {};
  resultRecords = [];
}
const workflows = Array.isArray(plan.workflows) ? plan.workflows : [];
const resultsById = new Map(resultRecords.map((item) => [item.id, item]));
const effectiveWorkflows = workflows.map((workflow) => ({
  ...workflow,
  status: resultsById.get(workflow.id)?.status ?? workflow.status,
  result: resultsById.get(workflow.id)
}));
const ids = workflows.map((workflow) => workflow.id);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const resultIds = resultRecords.map((result) => result.id);
const duplicateResultIds = resultIds.filter((id, index) => resultIds.indexOf(id) !== index);
const workflowIds = new Set(ids);
const resultsAligned = ids.every((id) => resultsById.has(id))
  && resultRecords.every((result) => workflowIds.has(result.id))
  && duplicateResultIds.length === 0;
const evidenceReady = resultRecords.every((result) => (
  !["pass", "known_limit", "blocked", "fail"].includes(result.status)
  || hasText(result.evidence)
)) && resultRecords.every((result) => (
  !["known_limit", "blocked", "fail"].includes(result.status)
  || hasText(result.notes)
));
const coverage = new Set(workflows.flatMap((workflow) => workflow.coverage ?? []));
const requiredCoverage = plan.policy?.requiredCoverage ?? [];

const failures = [
  !hasText(plan.releaseTarget) && fail("missing_release_target", "releaseTarget is required"),
  plan.policy?.allowSensitiveFiles !== false && fail("sensitive_files_not_forbidden", "policy.allowSensitiveFiles must be false"),
  !Array.isArray(plan.policy?.requiredCoverage) && fail("missing_required_coverage", "policy.requiredCoverage must be an array"),
  resultRecords.length > 0 && plan.releaseTarget !== resultFile.releaseTarget && fail("result_release_target_mismatch", {
    plan: plan.releaseTarget,
    results: resultFile.releaseTarget
  }),
  workflows.length < (plan.policy?.minimumWorkflowCount ?? 10) && fail("not_enough_workflows", {
    minimumWorkflowCount: plan.policy?.minimumWorkflowCount ?? 10,
    workflowCount: workflows.length
  }),
  duplicateIds.length > 0 && fail("duplicate_workflow_ids", duplicateIds),
  duplicateResultIds.length > 0 && fail("duplicate_result_ids", duplicateResultIds),
  ...ids
    .filter((id) => !resultsById.has(id))
    .map((id) => fail("missing_result_for_workflow", id)),
  ...resultRecords
    .filter((result) => !workflowIds.has(result.id))
    .map((result) => fail("result_without_workflow", result.id)),
  ...resultRecords.flatMap((result) => {
    const resultFailures = [];
    if (!hasText(result.id)) resultFailures.push(fail("result_missing_id", result));
    if (!allowedStatuses.has(result.status)) {
      resultFailures.push(fail("result_invalid_status", {
        id: result.id,
        status: result.status,
        allowed: [...allowedStatuses]
      }));
    }
    if (["pass", "known_limit", "blocked", "fail"].includes(result.status) && !hasText(result.evidence)) {
      resultFailures.push(fail("result_missing_evidence", result.id));
    }
    if (["known_limit", "blocked", "fail"].includes(result.status) && !hasText(result.notes)) {
      resultFailures.push(fail("result_missing_notes", {
        id: result.id,
        status: result.status
      }));
    }
    return resultFailures;
  }),
  ...requiredCoverage
    .filter((item) => !coverage.has(item))
    .map((item) => fail("missing_required_coverage_item", item)),
  ...effectiveWorkflows.flatMap((workflow) => {
    const workflowFailures = [];
    if (!hasText(workflow.id)) workflowFailures.push(fail("workflow_missing_id", workflow));
    if (!Array.isArray(workflow.coverage) || workflow.coverage.length === 0) workflowFailures.push(fail("workflow_missing_coverage", workflow.id));
    if (!hasText(workflow.input)) workflowFailures.push(fail("workflow_missing_input", workflow.id));
    if (!hasText(workflow.workflow)) workflowFailures.push(fail("workflow_missing_workflow", workflow.id));
    if (!hasText(workflow.path)) workflowFailures.push(fail("workflow_missing_path", workflow.id));
    if (!hasText(workflow.expected)) workflowFailures.push(fail("workflow_missing_expected", workflow.id));
    if (!allowedStatuses.has(workflow.status)) workflowFailures.push(fail("workflow_invalid_status", {
      id: workflow.id,
      status: workflow.status,
      allowed: [...allowedStatuses]
    }));
    if (strict && !passingStatuses.has(workflow.status)) workflowFailures.push(fail("workflow_not_release_ready", {
      id: workflow.id,
      status: workflow.status,
      required: [...passingStatuses]
    }));
    return workflowFailures;
  })
].filter(Boolean);

const result = {
  releaseTarget: plan.releaseTarget,
  strict,
  ok: failures.length === 0,
  workflowCount: workflows.length,
  minimumWorkflowCount: plan.policy?.minimumWorkflowCount ?? 10,
  statusCounts: countBy(effectiveWorkflows, "status"),
  coverage: [...coverage].toSorted(),
  requiredCoverage,
  resultCount: resultRecords.length,
  resultAudit: {
    alignedWithPlan: resultsAligned,
    evidenceReady
  },
  failures
};

function shouldOutputJson() {
  return process.argv.includes("--json") ||
         process.env.NODE_TEST_CONTEXT !== undefined ||
         process.env.NODE_ENV === "test";
}

if (shouldOutputJson()) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.ok) {
    console.log(`=== Fixture Check: PASS ===`);
    console.log(`All ${result.workflowCount} workflows verified successfully.`);
  } else {
    console.log(`=== Fixture Check: FAILED ===`);
    console.log(`Failing Checks:`);
    for (const failure of result.failures) {
      console.log(`- ${failure.code}: ${typeof failure.detail === 'object' ? JSON.stringify(failure.detail) : failure.detail}`);
    }
    console.log(`\nNext Action: Fix the failures above, or run 'npm run fixture-smoke' to regenerate mock results.`);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
