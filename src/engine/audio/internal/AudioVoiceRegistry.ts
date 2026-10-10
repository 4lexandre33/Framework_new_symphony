import type {
  AudioChannelType,
} from "../../../contracts/audio/types";

export interface AudioVoiceHandle {
  readonly source: AudioBufferSourceNode;
  readonly gainNode: GainNode;
  readonly pannerNode?: PannerNode;
}

export interface AudioVoiceMeta {
  readonly channel?: AudioChannelType;
  readonly loop?: boolean;
  readonly volume?: number;
  readonly hrtf?: boolean;
  /** true quando pedido com o contexto suspenso (antes do 1º gesto). */
  readonly deferred?: boolean;
  readonly requestedAtMs?: number;
}

/** Registro mutável de uma voz ativa (som com handle). */
export interface AudioVoiceRecord extends AudioVoiceHandle {
  readonly id: number;
  readonly channel: AudioChannelType;
  readonly loop: boolean;
  readonly hrtf: boolean;
  readonly order: number;
  volume: number;
  /** Fator de alcance (0..1) para `maxDistance` em inverse/exponential. */
  rangeFactor: number;
  rangeCutoff: boolean;
  maxDistance: number;
  px: number;
  py: number;
  pz: number;
  stopping: boolean;
  deferred: boolean;
  requestedAtMs: number;
}

/**
 * Vozes ativas indexadas por handle numérico (> 0). Cada voz é liberada
 * (nós desconectados) quando termina, é parada ou o registro é descartado.
 */
export class AudioVoiceRegistry {
  private readonly voices = new Map<number, AudioVoiceRecord>();
  private readonly bySource = new Map<AudioBufferSourceNode, number>();
  private nextId = 1;
  private nextOrder = 1;
  private disposed = false;

  public get activeVoiceCount(): number {
    return this.voices.size;
  }

  /** Compatibilidade: registra e devolve true/false. */
  public register(handle: AudioVoiceHandle, meta?: AudioVoiceMeta): boolean {
    return this.add(handle, meta) !== 0;
  }

  /** Registra a voz e devolve seu handle (0 se recusada). */
  public add(handle: AudioVoiceHandle, meta?: AudioVoiceMeta): number {
    if (this.disposed) {
      this.stopAndDisconnect(handle);
      return 0;
    }

    const source = handle.source;

    if (this.bySource.has(source)) {
      return 0;
    }

    const id = this.nextId;
    this.nextId += 1;

    const record: AudioVoiceRecord = {
      source,
      gainNode: handle.gainNode,
      pannerNode: handle.pannerNode,
      id,
      channel: meta?.channel ?? "sfx",
      loop: meta?.loop ?? false,
      hrtf: meta?.hrtf ?? false,
      order: this.nextOrder,
      volume: meta?.volume ?? 1,
      rangeFactor: 1,
      rangeCutoff: false,
      maxDistance: 0,
      px: 0,
      py: 0,
      pz: 0,
      stopping: false,
      deferred: meta?.deferred ?? false,
      requestedAtMs: meta?.requestedAtMs ?? 0,
    };

    this.nextOrder += 1;
    this.voices.set(id, record);
    this.bySource.set(source, id);

    source.onended = (): void => {
      this.release(source);
    };

    return id;
  }

  public get(id: number): AudioVoiceRecord | undefined {
    return this.voices.get(id);
  }

  public values(): IterableIterator<AudioVoiceRecord> {
    return this.voices.values();
  }

  public countHrtf(): number {
    let count = 0;

    for (const voice of this.voices.values()) {
      if (voice.hrtf) {
        count += 1;
      }
    }

    return count;
  }

  /** Voz mais antiga que pode ser roubada (one-shot; loops só se `includeLoops`). */
  public oldestStealable(includeLoops: boolean): AudioVoiceRecord | null {
    let best: AudioVoiceRecord | null = null;

    for (const voice of this.voices.values()) {
      if (voice.loop && !includeLoops) {
        continue;
      }

      if (best === null || voice.order < best.order) {
        best = voice;
      }
    }

    return best;
  }

  public release(sourceOrId: AudioBufferSourceNode | number): boolean {
    const id = typeof sourceOrId === "number" ? sourceOrId : this.bySource.get(sourceOrId);

    if (id === undefined) {
      return false;
    }

    const record = this.voices.get(id);

    if (record === undefined) {
      return false;
    }

    this.voices.delete(id);
    this.bySource.delete(record.source);
    record.source.onended = null;
    this.disconnect(record);
    return true;
  }

  /** Para a voz imediatamente e libera os nós. */
  public stopNow(id: number): boolean {
    const record = this.voices.get(id);

    if (record === undefined) {
      return false;
    }

    record.source.onended = null;

    try {
      record.source.stop();
    } catch {
      // Source já encerrada.
    }

    return this.release(id);
  }

  public stopAll(): void {
    for (const handle of this.voices.values()) {
      handle.source.onended = null;

      try {
        handle.source.stop();
      } catch {
        // Source já encerrada.
      }

      this.disconnect(handle);
    }

    this.voices.clear();
    this.bySource.clear();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stopAll();
    this.disposed = true;
  }

  private stopAndDisconnect(handle: AudioVoiceHandle): void {
    handle.source.onended = null;

    try {
      handle.source.stop();
    } catch {
      // Source já encerrada.
    }

    this.disconnect(handle);
  }

  private disconnect(handle: AudioVoiceHandle): void {
    try {
      handle.source.disconnect();
    } catch {
      // Node já desconectado.
    }

    if (handle.pannerNode !== undefined) {
      try {
        handle.pannerNode.disconnect();
      } catch {
        // Node já desconectado.
      }
    }

    try {
      handle.gainNode.disconnect();
    } catch {
      // Node já desconectado.
    }
  }
}
