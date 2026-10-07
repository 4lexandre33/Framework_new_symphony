import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(
  fileURLToPath(import.meta.url),
);

const ROOT = path.resolve(
  HERE,
  "..",
);

const failures = [];

function read(relPath) {
  const fullPath = path.join(
    ROOT,
    relPath,
  );

  if (!fs.existsSync(fullPath)) {
    failures.push(
      `arquivo ausente: ${relPath}`,
    );

    return "";
  }

  return fs.readFileSync(
    fullPath,
    "utf8",
  );
}

function requireText(
  relPath,
  expected,
) {
  const source = read(relPath);

  if (!source.includes(expected)) {
    failures.push(
      `${relPath} não contém: ${expected}`,
    );
  }
}

function forbidText(
  relPath,
  forbidden,
) {
  const source = read(relPath);

  if (source.includes(forbidden)) {
    failures.push(
      `${relPath} contém trecho proibido: ${forbidden}`,
    );
  }
}

requireText(
  "src/engine/net/internal/NetworkPacketValidator.ts",
  "MAX_NETWORK_PACKET_BYTES",
);
requireText(
  "src/engine/net/internal/WebSocketTransport.ts",
  "NETWORK_BACKPRESSURE_HIGH_WATER_BYTES",
);
requireText(
  "src/engine/net/internal/SteamP2PTransport.ts",
  "STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL",
);
requireText(
  "src/engine/net/internal/StateReplicator.ts",
  "isNewerSequence",
);
requireText(
  "src/engine/net/internal/NetworkService.ts",
  "pollInFlight",
);
requireText(
  "src/engine/net/internal/NetworkService.ts",
  "this.stateReplicator.clear();",
);

for (
  const relPath of [
    "src/engine/net/internal/NetworkPacketValidator.ts",
    "src/engine/net/internal/NetworkTransport.ts",
    "src/engine/net/internal/WebSocketTransport.ts",
    "src/engine/net/internal/SteamP2PTransport.ts",
    "src/engine/net/internal/StateReplicator.ts",
    "src/engine/net/internal/NetworkService.ts",
  ]
) {
  forbidText(
    relPath,
    "src/domain",
  );
  forbidText(
    relPath,
    "Math.random(",
  );
  forbidText(
    relPath,
    "setInterval(",
  );
}

if (failures.length > 0) {
  console.error(
    "ETAPA 83 NETWORKING SMOKE: FAIL",
  );

  for (const failure of failures) {
    console.error(
      `- ${failure}`,
    );
  }

  process.exit(1);
}

console.log(
  "ETAPA 83 NETWORKING SMOKE: PASS",
);
