export function getAiPrepareChecks(context) {
  const {
    appService,
    localServer,
    aiContext,
    manifestPanel
  } = context;

  return [
    {
      name: "ai_prepare_record_api_present",
      ok: Boolean(
        appService.includes("prepareRecordForAi")
        && localServer.includes("/api/ai/prepare-record")
        && aiContext.includes("renderDatasetMarkdown")
        && manifestPanel.includes("Prepare for AI")
      ),
      expected: {}
    }
  ];
}

export function getAiSupportChecks(context) {
  const {
    appService,
    localServer,
    aiSendGatePanel,
    queriesCore,
    evidenceCore,
    memoryQueryEngine,
    coreTests,
    maskingCore,
    aiCore,
    secretsAuditCore
  } = context;

  return [
    {
      name: "ai_result_writeback_present",
      ok: Boolean(
        appService.includes("writeBackAiResult")
        && localServer.includes("/api/ai/result/write-back")
        && aiSendGatePanel.includes("writeBackAiResult")
      ),
      expected: {}
    },
    {
      name: "filtered_table_ai_context_present",
      ok: Boolean(
        appService.includes("prepareQueryForAi")
        && appService.includes("saveQueryAiHandoffBundle")
        && localServer.includes("/api/ai/query-context")
        && localServer.includes("/api/ai/query-handoff")
        && queriesCore.includes("ai_query_context_selected")
        && queriesCore.includes("local_sql_query")
        && queriesCore.includes("engine: \"memory\"")
        && !queriesCore.includes("duckdb_query")
        && evidenceCore.includes("safeQueryShape")
        && memoryQueryEngine.includes("parseJoinClause")
        && memoryQueryEngine.includes("(?:inner\\s+)?join")
        && coreTests.includes("inner join")
        && coreTests.includes("local_sql_query")
        && !coreTests.includes("duckdb_query")
      ),
      expected: {}
    },
    {
      name: "expanded_secret_masking_present",
      ok: Boolean(
        maskingCore.includes("BEARER_TOKEN_REGEX")
        && maskingCore.includes("CLOUD_ACCESS_KEY_REGEX")
        && maskingCore.includes("LABELED_UUID_TOKEN_REGEX")
      ),
      expected: {}
    },
    {
      name: "blocked_ai_send_evidence_present",
      ok: Boolean(
        aiCore.includes("recordBlockedAiSend")
        && aiCore.includes("ai_send_blocked")
        && aiCore.includes("api_send_blocked")
      ),
      expected: {}
    },
    {
      name: "secrets_audit_signal_label_safe_present",
      ok: Boolean(
        secretsAuditCore.includes("strictSecretValueRegex")
        && secretsAuditCore.includes("metadataSignalKeys")
        && secretsAuditCore.includes("sendGateSignals")
      ),
      expected: {}
    }
  ];
}
