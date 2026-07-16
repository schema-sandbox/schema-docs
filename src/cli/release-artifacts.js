import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const artifactPaths = [
  "src-tauri/target/release/app.exe",
  "release/windows/schema-docs_0.1.0_x64_en-US.msi",
  "release/windows/schema-docs_0.1.0_x64-setup.exe",
  "release/windows/schema-docs_0.1.0_x64-portable.zip"
];

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

export async function describeReleaseArtifact(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false
    };
  }

  const stats = statSync(absolutePath);
  return {
    path: relativePath,
    exists: true,
    bytes: stats.size,
    sha256: await sha256File(absolutePath)
  };
}

export async function buildReleaseArtifactManifest() {
  return {
    releaseTarget: "v0.1.0",
    generatedBy: "npm run release-artifacts",
    artifacts: await Promise.all(artifactPaths.map(describeReleaseArtifact))
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await buildReleaseArtifactManifest(), null, 2));
}
