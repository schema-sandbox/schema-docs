import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const POWERPOINT_RENDER_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height
)

$ErrorActionPreference = "Stop"
$application = $null
$presentation = $null
try {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $application = New-Object -ComObject PowerPoint.Application
  $presentation = $application.Presentations.Open($SourcePath, $true, $false, $false)
  $presentation.Export($OutputDir, "PNG", $Width, $Height)
  Write-Output "adapter=powerpoint"
} finally {
  if ($null -ne $presentation) {
    try { $presentation.Close() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) } catch {}
  }
  if ($null -ne $application) {
    try { $application.Quit() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;

function slideNumber(fileName) {
  return Number(/(\d+)(?=\.[^.]+$)/.exec(fileName)?.[1]) || Number.MAX_SAFE_INTEGER;
}

function imageExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg" ? ".jpg" : ".png";
}

function powershellExecutable() {
  return process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "pwsh";
}

export async function renderPptxSlides(sourcePath, {
  outputDir,
  width = 1600,
  height = 900,
  timeoutMs = 8 * 60 * 1000
} = {}) {
  if (!outputDir) throw new Error("A slide render output directory is required.");
  if (process.platform !== "win32") throw new Error("PowerPoint slide rendering is currently available on Windows only.");

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pptx-render-"));
  const scriptPath = path.join(temporaryRoot, "render-slides.ps1");
  const renderedDir = path.join(temporaryRoot, "slides");
  try {
    await writeFile(scriptPath, POWERPOINT_RENDER_SCRIPT, "utf8");
    const { stdout = "" } = await execFileAsync(powershellExecutable(), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-SourcePath", path.resolve(sourcePath),
      "-OutputDir", renderedDir,
      "-Width", String(Math.max(320, Math.round(width))),
      "-Height", String(Math.max(180, Math.round(height)))
    ], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    const files = (await readdir(renderedDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(?:png|jpe?g)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => slideNumber(left) - slideNumber(right) || left.localeCompare(right));
    if (!files.length) throw new Error("PowerPoint did not produce any slide images.");

    await mkdir(outputDir, { recursive: true });
    for (const entry of await readdir(outputDir, { withFileTypes: true })) {
      if (entry.isFile() && /^slide-\d+-preview\.(?:png|jpe?g)$/i.test(entry.name)) {
        await rm(path.join(outputDir, entry.name), { force: true });
      }
    }

    const slides = [];
    for (let index = 0; index < files.length; index++) {
      const extension = imageExtension(files[index]);
      const fileName = `slide-${index + 1}-preview${extension}`;
      await copyFile(path.join(renderedDir, files[index]), path.join(outputDir, fileName));
      slides.push({ index: index + 1, fileName });
    }
    return {
      adapter: /adapter=powerpoint/i.test(stdout) ? "powerpoint" : "local-office",
      width: Math.max(320, Math.round(width)),
      height: Math.max(180, Math.round(height)),
      slides
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
