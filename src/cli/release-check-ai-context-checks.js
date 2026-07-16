export function getAiContextChecks(context) {
  const {
    appService,
    localServer,
    aiContext,
    aiFeedRunbook,
    appJs,
    aiContextPanel,
    apiContractDoc,
    aiContextTests
  } = context;

  return [
    {
      name: "ai_context_chunk_api_present",
      ok: Boolean(
        appService.includes("resolveAiContextChunk")
        && localServer.includes("/api/ai/context-chunk")
        && localServer.includes("/api/ai/context-range")
        && localServer.includes("/api/ai/feed-runbook")
        && aiContext.includes("buildAiIntakePlan")
        && aiFeedRunbook.includes("compileAiFeedRunbook")
        && appJs.includes("createAiFeedRunbookPanel")
        && aiContextPanel.includes("AI Intake Plan")
        && apiContractDoc.includes("/api/ai/context-chunk")
        && aiContextTests.includes("ai_context_range_selected")
      ),
      expected: {}
    }
  ];
}
