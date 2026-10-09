#!/usr/bin/env node
import { writeAiManual, checkAiManual } from "./lib/ai-manual-v1.mjs";

const check = process.argv.includes("--check");
try {
  if (check) {
    const problems = await checkAiManual();
    if (problems.length > 0) {
      console.error(`[AI-MANUAL] divergente do código (rode npm run ai-manual:generate):\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log("[AI-MANUAL] OK — manual em sincronia com o código.");
  } else {
    const written = await writeAiManual();
    console.log(`[AI-MANUAL] ${written.length} arquivos gerados em docs/ai/.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
