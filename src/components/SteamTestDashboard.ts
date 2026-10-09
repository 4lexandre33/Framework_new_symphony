import type { SteamApi } from "../tokens/steam";
import { makeEnvelope } from "@core";
import type { Kernel } from "@core";

export class SteamTestDashboard {
  private container: HTMLDivElement | null = null;
  private readonly steamService: SteamApi;
  private unsubscribeKernel: (() => void) | null = null;

  constructor(private readonly kernel: Kernel, steamService: SteamApi) {
    this.steamService = steamService;
  }

  public destroy(): void {
    if (this.unsubscribeKernel) {
      this.unsubscribeKernel();
      this.unsubscribeKernel = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  public render(parentElement: HTMLElement): void {
    if (this.container) {
      this.container.remove();
    }

    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.top = "10px";
    this.container.style.right = "10px";
    this.container.style.width = "360px";
    this.container.style.backgroundColor = "rgba(20, 26, 35, 0.95)";
    this.container.style.color = "#ffffff";
    this.container.style.border = "1px solid #2a475e";
    this.container.style.borderRadius = "8px";
    this.container.style.padding = "16px";
    this.container.style.fontFamily = "sans-serif";
    this.container.style.fontSize = "13px";
    this.container.style.zIndex = "999999";
    this.container.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";

    this.container.innerHTML = `
      <h3 style="margin-top:0; color:#66c0f4; border-bottom:1px solid #2a475e; padding-bottom:6px;">
        🎮 Steamworks HUD Test
      </h3>
      <div id="steam-status" style="margin-bottom:8px;">Carregando estado...</div>
      <div id="steam-user" style="margin-bottom:12px; font-weight:bold;"></div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <button id="btn-refresh-steam" style="background:#2a475e; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer;">
          🔄 Atualizar Status Steam
        </button>
        <button id="btn-unlock-ach" style="background:#66c0f4; color:#000; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">
          🏆 Desbloquear Conquista (ACH_KILL_DRAGON)
        </button>
      </div>
      <div id="steam-log" style="margin-top:12px; font-size:11px; color:#8f98a0; max-height:140px; overflow-y:auto; border-top:1px solid #2a475e; padding-top:6px; font-family:monospace;"></div>
    `;

    parentElement.appendChild(this.container);
    this.bindEvents();
    this.updateStatus();
  }

  private log(message: string): void {
    const logEl = this.container?.querySelector("#steam-log");
    if (logEl) {
      const time = new Date().toLocaleTimeString();
      logEl.innerHTML = `[${time}] ${message}<br>` + logEl.innerHTML;
    }
  }

  private async updateStatus(): Promise<void> {
    const statusEl = this.container?.querySelector("#steam-status");
    const userEl = this.container?.querySelector("#steam-user");

    const isAvailable = await this.steamService.checkAvailability();

    if (statusEl) {
      statusEl.innerHTML = isAvailable
        ? `<span style="color:#a4d007; font-weight:bold;">● Steamworks API Conectada (Online)</span>`
        : `<span style="color:#c15755; font-weight:bold;">● Steamworks Offline / Desenvolvedor</span>`;
    }

    if (isAvailable && userEl) {
      const user = await this.steamService.getUser();
      if (user) {
        userEl.innerHTML = `Jogador: <span style="color:#66c0f4;">${user.personaName}</span><br><span style="font-size:10px; color:#8f98a0;">Steam ID: ${user.steamId}</span>`;
      } else {
        userEl.innerHTML = "Usuário Steam não identificado.";
      }
    } else if (userEl) {
      userEl.innerHTML = "<span style=\"color:#8f98a0; font-weight:normal;\">Serviço rodando em fallback offline local.</span>";
    }
  }

  private bindEvents(): void {
    this.container?.querySelector("#btn-refresh-steam")?.addEventListener("click", async () => {
      this.log("Atualizando status da Steam...");
      await this.updateStatus();
    });

    this.container?.querySelector("#btn-unlock-ach")?.addEventListener("click", async () => {
      this.log("🏆 Enviando comando 'game.steam.unlock-achievement'...");

      const commandEnvelope = makeEnvelope({
        kind: "command",
        type: "game.steam.unlock-achievement",
        payload: {
          achievementId: "ACH_KILL_DRAGON",
        },
        source: "hud-dashboard",
      });

      try {
        const internal = this.kernel.__internal();
        const signal = new AbortController().signal;
        await internal.state.dispatcher.send(commandEnvelope as any, signal);
        
        const isOnline = await this.steamService.checkAvailability();
        if (isOnline) {
          this.log(`✅ Comando executado! Conquista enviada para a Steam.`);
        } else {
          this.log(`⚠️ Comando enviado ao Kernel (Steam Offline / Fallback).`);
        }
      } catch (err: any) {
        this.log(`❌ Falha no despacho do comando: ${err?.message || String(err)}`);
      }
    });
  }
}