export async function loadOptionalManifestUiData({
  loadCapabilities,
  loadAdapterCapabilities,
  loadSourceUpdates,
  onError = () => {}
}) {
  const tasks = [
    ["document capabilities", loadCapabilities],
    ["adapter capabilities", loadAdapterCapabilities],
    ["source updates", loadSourceUpdates]
  ];
  const settled = await Promise.allSettled(tasks.map(([, load]) => Promise.resolve().then(load)));
  const values = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    onError(tasks[index][0], result.reason);
    return null;
  });
  return {
    capabilities: values[0],
    adapterCapabilities: values[1],
    updates: Array.isArray(values[2]) ? values[2] : []
  };
}

export function refreshedDatasetSelection(manifest, selectedRecord) {
  const sourceType = String(selectedRecord?.sourceType || "").toLowerCase();
  const isDataset = selectedRecord?.kind === "dataset" || ["csv", "xls", "xlsx"].includes(sourceType);
  if (!isDataset || !selectedRecord?.id) return undefined;
  return (manifest?.datasets ?? []).find((dataset) => dataset.id === selectedRecord.id) ?? null;
}
