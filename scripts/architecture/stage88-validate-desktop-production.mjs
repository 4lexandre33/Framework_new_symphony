import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

function run(label, command, args) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("STAGE88 SEMANTIC AUDIT", process.execPath, ["scripts/architecture/stage88-audit-desktop-production.mjs"]);
run("STAGE88 FOCUSED TESTS", npx, ["vitest", "run",
  "tests/layer1-desktop-production-config.test.ts",
  "tests/layer1-native-tauri-contract.test.ts",
  "tests/layer1-native-tauri-security.test.ts",
  "tests/layer1-steamworks-native-contract.test.ts",
  "tests/layer1-render-viewport-camera.test.ts",
  "tests/layer1-input-keyboard-mouse.test.ts",
  "--no-file-parallelism",
]);
run("ARCHITECTURE", npm, ["run", "arch:check"]);
run("TYPESCRIPT", npx, ["tsc", "--noEmit"]);
run("VITEST FULL", npx, ["vitest", "run", "--no-file-parallelism"]);
run("CARGO CHECK", cargo, ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
run("VITE BUILD", npm, ["run", "build"]);
console.log("\n[OK] Stage88 preflight validation passed");
