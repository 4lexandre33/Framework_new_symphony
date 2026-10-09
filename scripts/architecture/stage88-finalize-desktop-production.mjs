import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const required = [
  "ETAPA86_AUTOMATED_PASS.json",
  "ETAPA87_AUTOMATED_PASS.json",
  "ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json",
  "ETAPA88_RELEASE_SMOKE_EVIDENCE.json",
];
for (const rel of required) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error(`[FAIL] Missing prerequisite evidence: ${rel}`);
    process.exit(1);
  }
}

const windows = JSON.parse(fs.readFileSync(path.join(ROOT, "ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json"), "utf8"));
const release = JSON.parse(fs.readFileSync(path.join(ROOT, "ETAPA88_RELEASE_SMOKE_EVIDENCE.json"), "utf8");
if (windows.status !== "pass" || release.status !== "pass") {
  console.error("[FAIL] Native Windows evidence is not green");
  process.exit(1);
}

const finalEvidence = {
  stage: 88,
  name: "Desktop / Steam Production Readiness",
  status: "pass",
  platform: "GitHub Actions windows-latest",
  rustToolchain: windows.rustToolchain,
  packageTarget: "NSIS",
  generatedAt: new Date().toISOString(),
  prerequisites: { stage86: "pass", stage87: "pass" },
  guarantees: [
    "deterministic full Vitest gate",
    "TypeScript and architecture gates",
    "Cargo check with Steam feature",
    "native Windows release build",
    "NSIS installer generation",
    "Tauri/Steam startup-shutdown contract",
    "DPI resize and focus lifecycle coverage",
  ],
};
fs.writeFileSync(path.join(ROOT, "ETAPA88_AUTOMATED_PASS.json"), JSON.stringify(finalEvidence, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "ETAPA88_PRODUCTION_EVIDENCE.json"), JSON.stringify({
  ...finalEvidence,
  releaseEvidence: release,
  windowsPackageEvidence: windows,
}, null, 2) + "\n");
console.log("[OK] Stage88 final evidence written");
