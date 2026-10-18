// Harness de navegador real (Chromium) para o G130: host com Kernel real
// (game.loop + game.net) numa aba "oculta" continua respondendo ao cliente.
// O relógio do pump em segundo plano é um Worker REAL (Blob). Empacotado por
// tests/browser/net-hidden.mjs.
import { Kernel, type Plugin, type PluginContext } from "@core";

import { HiddenTabPumpDriver } from "../../src/engine/net/internal/HiddenTabPumpDriver";
import { NetworkService } from "../../src/engine/net/internal/NetworkService";
import { createGameLoopPlugin } from "../../src/plugins/game-loop/plugin";
import { createNetworkPlugin, type NetworkPluginOptions } from "../../src/plugins/net/plugin";
import { NetworkToken, type NetworkApi } from "../../src/tokens/net";

type Result = Record<string, unknown>;

let hiddenOverride = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hiddenOverride });
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hiddenOverride ? "hidden" : "visible") });

function setHidden(hidden: boolean): void {
  hiddenOverride = hidden;
  document.dispatchEvent(new Event("visibilitychange"));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function scenario(room: string, pluginOptions: NetworkPluginOptions): Promise<Result> {
  let net: NetworkApi | undefined;
  let ticks = 0;
  const probe: Plugin = {
    manifest: {
      id: `test.net-probe-${room}`,
      name: "probe",
      version: "1.0.0",
      kind: "preloaded",
      dependsOn: [{ id: "game.net", range: "^1.0.0" }],
      permissions: { capabilities: [NetworkToken.id], events: ["game.loop.tick"] },
      capabilities: { provides: [], consumes: [{ id: NetworkToken.id, range: "^1.0.0", optional: false }] },
      lifecycleHooks: {
        onBoot(ctx: PluginContext): void {
          net = ctx.caps.require(NetworkToken);
        },
      },
    },
    setup(ctx: PluginContext): void {
      const off = ctx.events.on("game.loop.tick", (): void => {
        ticks += 1;
      });
      ctx.lifecycle.onDispose(off);
      ctx.lifecycle.ready();
    },
  };

  const kernel = new Kernel();
  kernel.register(createGameLoopPlugin());
  kernel.register(createNetworkPlugin(pluginOptions));
  kernel.register(probe);
  await kernel.boot();

  const clientEvents: string[] = [];
  const client = new NetworkService({
    events: { emit: (type: string): void => void clientEvents.push(type) },
  } as unknown as PluginContext);
  const clientPump = setInterval((): void => void client.pollPackets(), 16);

  try {
    net!.configure({ heartbeatIntervalMs: 200, peerTimeoutMs: 1500 });
    client.configure({ heartbeatIntervalMs: 200, peerTimeoutMs: 1500 });
    const hosted = await net!.startHost({ room });
    const connected = await client.connect(`loopback://${room}`);
    await wait(300);

    setHidden(true);
    const ticksAtHide = ticks;
    await wait(3500); // > 2× peerTimeoutMs
    const ticksWhileHidden = ticks - ticksAtHide;
    const result = {
      hosted,
      connected,
      ticksWhileHidden,
      clientStillConnected: client.mode === "client" && !clientEvents.includes("game.net.peer-disconnected"),
      hostPeers: net!.getPeers().length,
    };
    setHidden(false);
    return result;
  } finally {
    clearInterval(clientPump);
    client.dispose();
    await kernel.stop();
  }
}

(window as unknown as { netHidden: unknown }).netHidden = {
  withPump: (): Promise<Result> => scenario("bg-on", {}),
  withoutPump: (): Promise<Result> => scenario("bg-off", { backgroundPump: false }),
  async workerClock(): Promise<Result> {
    let pulses = 0;
    const driver = new HiddenTabPumpDriver((): void => void (pulses += 1), { intervalMs: 50 });
    driver.start();
    setHidden(true);
    const source = driver.source;
    await wait(600);
    setHidden(false);
    const afterShow = pulses;
    await wait(300);
    const pulsesAfterShow = pulses - afterShow;
    driver.dispose();
    return { source, pulses: afterShow, pulsesAfterShow };
  },
};
