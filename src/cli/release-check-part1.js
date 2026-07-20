export function getChecksPart1(context) {
  const {
    packageJson,
    sizeCheckCli,
    releaseDocTexts,
    requiredDocs,
    desktopHandoffLabels,
    desktopFixtureCloseWriteCommand,
    forbiddenDocFragments,
    releaseDocsCombined,
    forbiddenDocFragmentCodes,
    requiredScripts,
    expectedTestSummary,
    cleanupArtifactsCli,
    coreSmoke,
    releaseReadinessCli,
    releaseArtifactsCli,
    releaseArtifactsIndexCli,
    privateBetaPackageCli,
    betaCheckCli,
    rcCheckCli,
    languageBoundaryCheckCli,
    doctorCli,
    largeIntakeCheckCli,
    coreTests,
    sdkClient,
    apiContractDoc,
    desktopVerificationCheck,
    desktopVerificationRecord,
    desktopVerificationTemplate,
    desktopReleasePreflight,
    desktopPreflightCheck,
    realSampleSummary,
    fileExists
  } = context;
  const readmeDoc = releaseDocTexts["README.md"] ?? "";
  const manualChecklist = releaseDocTexts["docs/public-preview-manual-test-checklist.md"] ?? "";
  const errorCatalogDoc = releaseDocTexts["docs/error-catalog.md"] ?? "";
  const publicPreviewSampleReport = releaseDocTexts["docs/public-preview-sample-report.md"] ?? "";
  const errorCatalogEntries = [
    "What happened",
    "Why it matters",
    "What to do next",
    "csv_empty",
    "api_base_url_required",
    "record_markdown_missing",
    "query_column_not_found",
    "api_request_failed",
    "api_response_non_json",
    "ai_handoff_context_empty",
    "ai_send_gate_review_required",
    "runtime_unavailable"
  ];
  const apiContractEntries = [
    "SchemaDocsApiError",
    "guidance",
    "schema_docs_api_non_json_response",
    "x-ai-doc-exchange-token",
    "POST /api/import",
    "POST /api/import-upload",
    "POST /api/ai/preview",
    "POST /api/exchange-packages/from-record"
  ];

  return [
    {
      name: "runtime_dependencies_zero",
      ok: Object.keys(packageJson.dependencies ?? {}).length === 0
    },
    {
      name: "lightweight_size_budget_enforced",
      ok: Boolean(
        sizeCheckCli.includes("const BUDGETS")
        && sizeCheckCli.includes("runtimeDependencies: 0")
        && sizeCheckCli.includes("runtimeBytes: 1_300_000")
        && sizeCheckCli.includes("sourceFiles: 195")
        && sizeCheckCli.includes("totalBytes: 1_850_000")
        && sizeCheckCli.includes("totalLines: 42_000")
        && sizeCheckCli.includes("largestFileBytes: 100_000")
        && sizeCheckCli.includes("runtimeLargestFileBytes: 125_000")
        && sizeCheckCli.includes("publicModuleBytes: 100_000")
        && sizeCheckCli.includes("process.exitCode = 1")
        && sizeCheckCli.includes("source bytes are above 80% of budget")
        && sizeCheckCli.includes("largest source file is above 90% of budget")
        && sizeCheckCli.includes("largest runtime file is above 90% of budget")
        && sizeCheckCli.includes("largest public browser module is above 90% of budget")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("1.7MB source budget")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("largest source file exceeds 90%")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("largest runtime file exceeds 90%")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("1.16MB runtime budget")
        && releaseDocTexts["docs/release-checklist.md"]?.includes("1.16MB runtime bytes")
      ),
      expected: {}
    },
    {
      name: "release_docs_present",
      ok: requiredDocs.every(fileExists),
      requiredDocs
    },
    {
      name: "release_docs_text_integrity",
      ok: Boolean(
        desktopHandoffLabels.every((label) => releaseDocTexts["docs/desktop-verification-protocol.md"]?.includes(label))
        && desktopHandoffLabels.slice(0, 4).every((label) => releaseDocTexts["docs/release-checklist.md"]?.includes(label))
        && desktopHandoffLabels.slice(0, 4).every((label) => readmeDoc.includes(label))
        && ["README.md", "docs/release-checklist.md", "docs/sample-fixture-checklist.md", "docs/v0.1.0-release-plan.md", "docs/v0.1.0-release-notes.md"]
          .every((doc) => releaseDocTexts[doc]?.includes(desktopFixtureCloseWriteCommand))
        && readmeDoc.includes("# Schema Docs (v0.1.1)")
        && readmeDoc.includes("Windows public-preview package")
        && readmeDoc.includes("Public preview scope")
        && readmeDoc.includes("packaged Node runtime resource")
        && readmeDoc.includes("falls back to system Node")
        && readmeDoc.includes("ai-context ./tmp-workspace preview doc_xxxx")
        && readmeDoc.includes("ai-context ./tmp-workspace plan")
        && !readmeDoc.includes("ai-context preview doc_xxxx")
        && readmeDoc.includes("document-to <workspace> <recordId> md outputs/document.md")
        && !readmeDoc.includes("extract <workspace>")
        && readmeDoc.includes("mask <workspace>")
        && readmeDoc.includes("unmask <workspace> <masked-text> '<mapping-json>'")
        && !readmeDoc.includes("npm run cli -- mask \"")
        && !readmeDoc.includes("npm run cli -- unmask <masked-text>")
        && readmeDoc.includes("sendAllowedAfterReview")
        && readmeDoc.includes("blockingWarnings")
        && readmeDoc.includes(expectedTestSummary.badge)
        && readmeDoc.includes(expectedTestSummary.readme)
        && releaseDocTexts["docs/implementation-status.md"]?.includes(expectedTestSummary.docs)
        && readmeDoc.includes("npm run public-preview-package -- --json")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("npm run public-preview-package -- --json")
        && releaseDocTexts["docs/private-beta-checklist.md"]?.includes(expectedTestSummary.docs)
        && ["Test Environment Metadata", "Evidence to Capture", "30-Minute Public Preview Smoke Script", "Failure Report Template", "bundled `runtime/node.exe` path or a system `node` fallback"]
          .every((text) => manualChecklist.includes(text))
        && !manualChecklist.includes("detected system node version")
        && errorCatalogEntries.every((text) => errorCatalogDoc.includes(text))
        && coreTests.includes("query_column_not_found")
        && coreTests.includes("api_request_failed")
        && coreTests.includes("api_response_non_json")
        && coreTests.includes("ai_handoff_context_empty")
        && sdkClient.includes("this.guidance")
        && sdkClient.includes("schema_docs_api_non_json_response")
        && apiContractEntries.every((text) => apiContractDoc.includes(text))
        && !apiContractDoc.includes("POST /api/documents/import")
        && !apiContractDoc.includes("POST /api/ai-preview")
        && !apiContractDoc.includes("],,")
        && [
          "Desktop diagnostics",
          "Run first workflow",
          "Choose workspace",
          "Choose local file",
          "Generate diagnostic bundle",
          "Generate send preview",
          "Confirm send",
          "Save exchange package",
          "Read and verify package",
          "Write receiver report",
          "View trust report"
        ].every((label) => manualChecklist.includes(label))
        && releaseDocTexts["docs/sample-scenarios.md"]?.includes("Product Capability Classifications")
        && releaseDocTexts["docs/sample-scenarios.md"]?.includes("AI-READY AFTER REVIEW")
        && releaseDocTexts["docs/sample-scenarios.md"]?.includes("DOWNGRADED BEFORE AI SEND")
        && releaseDocTexts["docs/sample-scenarios.md"]?.includes("all reviewed warning checks passed")
        && releaseDocTexts["docs/real-sample-regression.md"]?.includes("real-sample capability coverage")
        && !readmeDoc.includes("# Schema Docs (v1.0.0)")
        && !readmeDoc.includes("standalone desktop client with no local runtime requirement")
        && !readmeDoc.includes("no Node environment required on every machine")
        && !forbiddenDocFragments.some((fragment) => releaseDocsCombined.includes(fragment))
      ),
      expected: {
        docs: ["README.md", "docs/desktop-verification-protocol.md", "docs/release-checklist.md", "docs/sample-fixture-checklist.md", "docs/v0.1.0-release-plan.md", "docs/v0.1.0-release-notes.md"],
        requiredDesktopLabels: desktopHandoffLabels,
        publicPreviewPackageCommand: "npm run public-preview-package -- --json",
        runtimeDiagnosticExpectation: "bundled runtime/node.exe or system node fallback",
        desktopFixtureCloseWriteCommand,
        forbiddenMojibakeFragments: forbiddenDocFragmentCodes
      }
    },
    {
      name: "public_preview_sample_report_current",
      ok: Boolean(
        realSampleSummary?.total >= 20
        && publicPreviewSampleReport.includes(`${realSampleSummary.total} real/representative document sample checks`)
        && publicPreviewSampleReport.includes(`${realSampleSummary.statusCounts.pass} \`pass\`, ${realSampleSummary.statusCounts.known_limit} \`known_limit\`, ${realSampleSummary.statusCounts.blocked} \`blocked\``)
        && publicPreviewSampleReport.includes("expected Send Gate safety result")
        && ["ai_intake", "safety_gate", "format_exchange", "table_filter", "long_input", "external_refresh"]
          .every((capability) => Number(realSampleSummary.capabilityCoverage?.[capability] ?? 0) > 0 && publicPreviewSampleReport.includes(capability))
      ),
      expected: {
        sampleMinimum: 20,
        requiredCapabilities: ["ai_intake", "safety_gate", "format_exchange", "table_filter", "long_input", "external_refresh"],
        source: "samples/real-sample-results.json",
        report: "docs/public-preview-sample-report.md"
      },
      actual: realSampleSummary
    },
    {
      name: "required_scripts_present",
      ok: requiredScripts.every((script) => Boolean(packageJson.scripts?.[script])),
      scripts: requiredScripts
    },
    {
      name: "cleanup_artifacts_dry_run_present",
      ok: Boolean(
        packageJson.scripts?.["cleanup-artifacts"] === "node src/cli/cleanup-artifacts.js"
        && packageJson.scripts?.["cleanup-artifacts:apply"] === "node src/cli/cleanup-artifacts.js --apply"
        && packageJson.scripts?.["root-clean-check"] === "node src/cli/cleanup-artifacts.js --check"
        && cleanupArtifactsCli.includes("mode: APPLY ? \"apply\" : \"dry-run\"")
        && cleanupArtifactsCli.includes("checkOnly: CHECK")
        && cleanupArtifactsCli.includes("isInsideRoot")
        && cleanupArtifactsCli.includes("--root")
        && cleanupArtifactsCli.includes("Refusing to remove unsafe path")
        && cleanupArtifactsCli.includes("tmp-test-")
        && cleanupArtifactsCli.includes("tmp-workspace")
        && cleanupArtifactsCli.includes("%TEMP%")
        && cleanupArtifactsCli.includes(".desktop-runtime")
        && cleanupArtifactsCli.includes("tmp-doctor-workspace-integrated")
      ),
      expected: {}
    },
    {
      name: "core_smoke_receiver_report_present",
      ok: Boolean(
        packageJson.scripts?.smoke === "node src/cli/smoke.js"
        && coreSmoke.includes("writeExchangePackageReceiverReport")
        && coreSmoke.includes("receiverReportOk")
        && coreSmoke.includes("receiver-report.md")
        && coreSmoke.includes("trust-report.json")
        && coreSmoke.includes("failedChecks")
        && coreSmoke.includes("process.exitCode = 1")
      ),
      expected: {
        script: "smoke",
        verifies: ["exchange package read-back", "receiver report write", "trust report write"],
        failsOnBrokenChecks: true
      }
    },
    {
      name: "release_readiness_present",
      ok: Boolean(
        packageJson.scripts?.["release-readiness"] === "node src/cli/release-readiness.js"
        && releaseReadinessCli.includes("release-check.js")
        && releaseReadinessCli.includes("fixture-check.js")
        && releaseReadinessCli.includes("--strict")
        && releaseReadinessCli.includes("--report-only")
        && releaseReadinessCli.includes("--out")
        && releaseReadinessCli.includes("writeFile")
        && releaseReadinessCli.includes("readyForPublicTag")
        && releaseReadinessCli.includes("blockingItems")
        && releaseReadinessCli.includes("npm run large-intake-check")
        && releaseReadinessCli.includes("npm run language-boundary-check")
        && releaseReadinessCli.includes("npm run doctor")
        && releaseReadinessCli.includes("npm run release-artifacts")
        && releaseReadinessCli.includes("npm run release-index")
        && releaseReadinessCli.includes("npm run public-preview-package -- --json")
        && releaseReadinessCli.includes("desktop-release-preflight")
        && releaseReadinessCli.includes("desktop-preflight-check")
        && releaseReadinessCli.includes("desktop-verification-fill")
        && releaseReadinessCli.includes("release artifact SHA-256 match")
        && releaseReadinessCli.includes("desktop-fixture-close")
        && releaseReadinessCli.includes("missingRequiredCapabilities")
        && releaseReadinessCli.includes("real_sample_capabilities")
        && releaseReadinessCli.includes("PUBLIC_REAL_SAMPLE_MINIMUM = 20")
        && releaseReadinessCli.includes("public-preview")
        && releaseReadinessCli.includes("ai_intake")
        && releaseReadinessCli.includes("safety_gate")
        && releaseReadinessCli.includes("format_exchange")
      ),
      expected: {
        script: "release-readiness",
        combines: ["release-check", "fixture-check --strict"],
        reports: ["readyForPublicTag", "blockingItems", "nextActions"],
        commands: ["release-check", "large-intake-check", "language-boundary-check", "doctor", "fixture-check --strict", "release-artifacts", "release-index", "public-preview-package -- --json", "desktop-release-preflight", "desktop-preflight-check", "desktop-verification-fill", "desktop-verification-check --strict", "desktop-fixture-close --write"],
        reportOnlyMode: "--report-only",
        writes: "--out <readiness.json>",
        desktopArtifactGate: "filled record artifact SHA-256 must match npm run release-artifacts before F-012 closure"
      }
    },
    {
      name: "release_artifact_manifest_present",
      ok: Boolean(
        packageJson.scripts?.["release-artifacts"] === "node src/cli/release-artifacts.js"
        && releaseArtifactsCli.includes("sha256File")
        && releaseArtifactsCli.includes("src-tauri/target/release/app.exe")
        && releaseArtifactsCli.includes("schema-docs_0.1.1_x64_en-US.msi")
        && releaseArtifactsCli.includes("schema-docs_0.1.1_x64-setup.exe")
        && releaseArtifactsCli.includes("sha256")
      ),
      expected: {
        script: "release-artifacts",
        reports: ["path", "exists", "bytes", "sha256"]
      }
    },
    {
      name: "release_artifact_index_present",
      ok: Boolean(
        packageJson.scripts?.["release-index"] === "node src/cli/release-artifacts-index.js"
        && releaseArtifactsIndexCli.includes("buildReleaseArtifactManifest")
        && releaseArtifactsIndexCli.includes("buildReleaseReadiness")
        && releaseArtifactsIndexCli.includes("docs/release-artifact-index.md")
        && releaseArtifactsIndexCli.includes("samples/release-artifact-index.json")
        && releaseArtifactsIndexCli.includes("mkdir(path.dirname(resolvedPath), { recursive: true })")
        && releaseArtifactsIndexCli.includes("recommendedAudience")
        && releaseArtifactsIndexCli.includes("verificationCommand")
        && releaseArtifactsIndexCli.includes("npm run large-intake-check")
        && releaseArtifactsIndexCli.includes("npm run language-boundary-check")
        && releaseArtifactsIndexCli.includes("npm run doctor")
        && releaseArtifactsIndexCli.includes("npm run public-preview-package -- --json")
        && releaseArtifactsIndexCli.includes("desktop-verification-fill")
        && releaseDocTexts["docs/v0.1.0-release-plan.md"]?.includes("npm run release-index")
      ),
      expected: {}
    },
    {
      name: "release_package_handoff_present",
      ok: Boolean(
        packageJson.scripts?.["public-preview-package"] === "node src/cli/private-beta-package.js --mode public-preview"
        && packageJson.scripts?.["private-beta-package"] === "node src/cli/private-beta-package.js"
        && privateBetaPackageCli.includes("primary-public-preview-installer")
        && privateBetaPackageCli.includes("primary-private-beta-installer")
        && privateBetaPackageCli.includes("unsupported-mode-installer")
        && privateBetaPackageCli.includes("Do not hand off this installer until the release mode is corrected.")
        && privateBetaPackageCli.includes("npm run doctor")
        && privateBetaPackageCli.includes("npm run desktop:ai-summon-smoke")
        && privateBetaPackageCli.includes("npm run rc-check -- --mode")
        && privateBetaPackageCli.includes("npm run beta-check -- --mode")
      ),
      expected: {
        scripts: ["public-preview-package", "private-beta-package"],
        commands: ["npm run doctor", "npm run rc-check -- --mode <mode>"],
        unsupportedModeGuard: "required"
      }
    },
    {
      name: "beta_check_release_blocker_exit_present",
      ok: Boolean(
        packageJson.scripts?.["beta-check"] === "node src/cli/beta-check.js"
        && betaCheckCli.includes("buildReleaseReadiness")
        && betaCheckCli.includes("arg === \"--results\"")
        && betaCheckCli.includes("resultsPath = argValue(\"--results\")")
        && betaCheckCli.includes("buildReleaseReadiness({ mode, resultsPath })")
        && betaCheckCli.includes("report.blockers.push(`release-readiness")
        && betaCheckCli.includes("mkdir(path.dirname(reportPath), { recursive: true })")
        && betaCheckCli.includes("writeFile")
        && betaCheckCli.includes("process.exitCode = 1")
      ),
      expected: {
        script: "beta-check",
        verifies: ["nonzero exit when not ready", "--write-report output directory creation"]
      }
    },
    {
      name: "rc_preflight_present",
      ok: Boolean(
        packageJson.scripts?.["rc-check"] === "node src/cli/rc-check.js"
        && rcCheckCli.includes("node:child_process")
        && rcCheckCli.includes("--test")
        && rcCheckCli.includes("size-check.js")
        && rcCheckCli.includes("large-intake-check.js")
        && rcCheckCli.includes("language-boundary-check.js")
        && rcCheckCli.includes("release-check.js")
        && rcCheckCli.includes("fixture-check.js")
        && rcCheckCli.includes("--strict")
        && rcCheckCli.includes("release-readiness.js")
        && rcCheckCli.includes("beta-check.js")
        && rcCheckCli.includes("betaCheck")
        && rcCheckCli.includes("\"public-preview\"")
        && rcCheckCli.includes("--mode")
        && rcCheckCli.includes("--json")
        && rcCheckCli.includes("releaseTarget")
        && rcCheckCli.includes("releaseMode")
        && rcCheckCli.includes("generatedAt")
        && rcCheckCli.includes("commands")
        && rcCheckCli.includes("npm run fixture-check -- --strict")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("npm run public-preview-package -- --json")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("records `releaseTarget`, `releaseMode`, `generatedAt`, `commands`, and per-check results")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("decision.ready: true")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("primary NSIS installer path")
      ),
      expected: {
        verifies: ["beta-check --mode <mode> --json", "public-preview-package -- --json installer handoff", "JSON report metadata for release archive"]
      }
    },
    {
      name: "language_boundary_check_present",
      ok: Boolean(
        packageJson.scripts?.["language-boundary-check"] === "node src/cli/language-boundary-check.js"
        && languageBoundaryCheckCli.includes("Default runtime")
        && languageBoundaryCheckCli.includes("defaultEnglishPatterns")
        && languageBoundaryCheckCli.includes("allowedMultilingualPatterns")
        && languageBoundaryCheckCli.includes("blocked")
        && languageBoundaryCheckCli.includes("Mojibake is blocked everywhere")
        && languageBoundaryCheckCli.includes('reason: "mojibake"')
        && readmeDoc.includes("npm run language-boundary-check")
        && releaseDocTexts["docs/release-checklist.md"]?.includes("npm run language-boundary-check")
        && releaseDocTexts["docs/release-candidate-process.md"]?.includes("language-boundary-check")
      ),
      expected: {
        script: "language-boundary-check",
        verifies: ["default runtime English boundary", "mojibake guard"]
      }
    },
    {
      name: "doctor_cli_present",
      ok: Boolean(
        packageJson.scripts?.doctor === "node src/cli/doctor.js"
        && doctorCli.includes("Schema Docs Doctor Report")
        && doctorCli.includes("[OK]")
        && doctorCli.includes("[WARN]")
        && doctorCli.includes("[FAIL]")
        && doctorCli.includes("detectAdapterCapabilities")
        && doctorCli.includes("Zero runtime dependencies verified")
        && doctorCli.includes("Workspace directory is writable")
        && doctorCli.includes("Desktop app installer artifact")
      ),
      expected: {
        script: "doctor",
        outputStyle: "ASCII status labels",
        verifies: ["optional adapter capabilities"]
      }
    },
    {
      name: "large_ai_intake_check_present",
      ok: Boolean(
        packageJson.scripts?.["large-intake-check"] === "node src/cli/large-intake-check.js"
        && largeIntakeCheckCli.includes("SCHEMA_DOCS_LARGE_INTAKE_SENTINEL")
        && largeIntakeCheckCli.includes("targetPages = 7900")
        && largeIntakeCheckCli.includes("compileAiIntakeManifest")
        && largeIntakeCheckCli.includes("compileAiFeedRunbook")
        && largeIntakeCheckCli.includes("resolveAiContextChunkRange")
        && largeIntakeCheckCli.includes("background_range_feeding")
        && largeIntakeCheckCli.includes("requiresSendGateReview === true")
        && largeIntakeCheckCli.includes("sendsContentAutomatically === false")
        && largeIntakeCheckCli.includes("intake manifest leaked document body text")
        && largeIntakeCheckCli.includes("runbook JSON leaked document body text")
        && releaseReadinessCli.includes("npm run large-intake-check")
        && rcCheckCli.includes("large-intake-check.js")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("npm run large-intake-check")
      ),
      expected: {
        script: "large-intake-check",
        verifies: ["content-free intake manifest", "range content pulled only on demand"]
      }
    },
    {
      name: "desktop_verification_record_ready",
      ok: Boolean(
        packageJson.scripts?.["desktop-verification-check"] === "node src/cli/desktop-verification-check.js"
        && packageJson.scripts?.["desktop-verification-record"] === "node src/cli/desktop-verification-record.js"
        && desktopVerificationCheck.includes("--strict")
        && desktopVerificationCheck.includes("samples/desktop-verification-record.template.json")
        && desktopVerificationRecord.includes("buildReleaseArtifactManifest")
        && desktopVerificationRecord.includes("--app-smoke-json")
        && desktopVerificationRecord.includes("--workflow-smoke-json")
        && desktopVerificationRecord.includes("--bridge-smoke-json")
        && desktopVerificationRecord.includes("--out")
        && desktopVerificationRecord.includes("writeFile")
        && desktopVerificationRecord.includes("Generated partial record")
        && desktopVerificationTemplate?.recordType === "desktop-verification"
        && desktopVerificationTemplate?.releaseTarget === "v0.1.1"
        && desktopVerificationTemplate?.visibleUi?.desktopDiagnostics
        && desktopVerificationTemplate?.visibleUi?.firstWorkflow
        && desktopVerificationTemplate?.visibleUi?.workspacePicker
        && desktopVerificationTemplate?.visibleUi?.filePicker
        && desktopVerificationTemplate?.sendGate
      ),
      expected: {}
    },
    {
      name: "desktop_release_preflight_present",
      ok: Boolean(
        packageJson.scripts?.["desktop-release-preflight"] === "node src/cli/desktop-release-preflight.js"
        && desktopReleasePreflight.includes("buildReleaseArtifactManifest")
        && desktopReleasePreflight.includes("buildDesktopVerificationRecord")
        && desktopReleasePreflight.includes("buildReleaseReadiness")
        && desktopReleasePreflight.includes("buildPreflightManifest")
        && desktopReleasePreflight.includes("buildHandoffSummary")
        && desktopReleasePreflight.includes("portableEvidencePath")
        && desktopReleasePreflight.includes("path.relative")
        && desktopReleasePreflight.includes("createHash")
        && desktopReleasePreflight.includes("quoteCommandArg")
        && desktopReleasePreflight.includes("desktop-app-smoke.js")
        && desktopReleasePreflight.includes("desktop-workflow-smoke.js")
        && desktopReleasePreflight.includes("desktop-bridge-smoke.js")
        && desktopReleasePreflight.includes("--include-gui-smoke")
        && desktopReleasePreflight.includes("desktop-app-smoke.full.json")
        && desktopReleasePreflight.includes("desktop-workflow-smoke.full.json")
        && desktopReleasePreflight.includes("release-readiness.json")
        && desktopReleasePreflight.includes("desktop-handoff-summary.json")
        && desktopReleasePreflight.includes("desktop-preflight-manifest.json")
        && desktopReleasePreflight.includes("desktop-verification.strict-preview.json")
        && desktopReleasePreflight.includes("desktop-handoff.md")
        && desktopReleasePreflight.includes("renderDesktopHandoff")
        && desktopReleasePreflight.includes("remainingManualGate")
        && desktopReleasePreflight.includes("releaseCommands")
        && desktopReleasePreflight.includes("buildReleaseCommandChecklist")
        && desktopReleasePreflight.includes("npm run public-preview-package -- --json")
        && desktopReleasePreflight.includes("portableEvidence")
        && desktopReleasePreflight.includes("manualVerificationSteps")
        && desktopReleasePreflight.includes("Release Command Checklist")
        && desktopReleasePreflight.includes("Preflight Check Command")
        && desktopReleasePreflight.includes("Portable Evidence Paths")
        && desktopReleasePreflight.includes("Manual Verification Steps")
        && desktopReleasePreflight.includes("--webview2-present yes")
        && desktopPreflightCheck.includes("includesAllCommands")
        && desktopPreflightCheck.includes("npm run public-preview-package -- --json")
      ),
      expected: {}
    },
    {
      name: "error_and_sdk_documentation_integrity",
      ok: Boolean(
        releaseDocTexts["docs/error-catalog.md"]?.includes("csv_empty")
        && releaseDocTexts["docs/error-catalog.md"]?.includes("What happened")
        && releaseDocTexts["docs/error-catalog.md"]?.includes("What to do next")
        && sdkClient.includes("this.guidance")
        && releaseDocTexts["docs/api-contract.md"]?.includes("guidance")
      ),
      expected: {}
    },
    {
      name: "save_clean_ai_ready_copy_sanitization_enforced",
      ok: Boolean(
        context.aiContextPanel.includes("saveCleanAiReadyCopy")
        && context.aiContextPanel.includes('api("/api/mask"')
      ),
      expected: {
        source: "public/aiContextPanel.js",
        target: "saveCleanAiReadyCopy must call /api/mask"
      }
    }
  ];
}
