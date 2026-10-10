import type {
  PlayerOnlineProfile,
} from "../../../contracts/storage/types";

/**
 * Backend remoto de perfis (G100). Implemente para o seu serviço (BaaS,
 * servidor próprio, Steam...) ou use `HttpPlayerProfileBackend` com um
 * endpoint. Erros devem ser lançados (viram `success: false` + mensagem).
 */
export interface PlayerProfileBackend {
  /** false = o backend não faz sincronização real (padrão sem configuração). */
  readonly supported?:
    boolean;

  write(
    profile:
      PlayerOnlineProfile,
  ): Promise<void>;

  read(
    playerId: string,
  ): Promise<
    PlayerOnlineProfile | null
  >;

  dispose?(): void;
}

function cloneProfile(
  profile:
    PlayerOnlineProfile,
): PlayerOnlineProfile {
  return {
    playerId:
      profile.playerId,

    displayName:
      profile.displayName,

    rankScore:
      profile.rankScore,

    inventoryData:
      {
        ...profile
          .inventoryData,
      },

    lastSyncedTimestamp:
      profile.lastSyncedTimestamp,
  };
}

/**
 * Padrão SEM backend remoto configurado (G100): nunca finge sucesso.
 * `syncProfile` retorna false com erro "unsupported" e `fetchProfile` null.
 */
export class UnsupportedPlayerProfileBackend
  implements PlayerProfileBackend {
  public readonly supported =
    false;

  public async write(): Promise<void> {
    throw new Error(
      "unsupported",
    );
  }

  public async read(): Promise<null> {
    return null;
  }
}

/**
 * Backend em memória (testes/protótipos). NÃO é online: os dados somem ao
 * fechar o jogo. Precisa ser injetado explicitamente.
 */
export class MemoryPlayerProfileBackend
  implements PlayerProfileBackend {
  private readonly profiles =
    new Map<
      string,
      PlayerOnlineProfile
    >();

  public async write(
    profile:
      PlayerOnlineProfile,
  ): Promise<void> {
    this.profiles.set(
      profile.playerId,
      cloneProfile(
        profile,
      ),
    );
  }

  public async read(
    playerId: string,
  ): Promise<
    PlayerOnlineProfile | null
  > {
    const profile =
      this.profiles.get(
        playerId,
      );

    return profile ===
      undefined
      ? null
      : cloneProfile(
          profile,
        );
  }

  public dispose():
    void {
    this.profiles.clear();
  }
}

export interface CloudDatabaseDriverOptions {
  readonly backend?:
    PlayerProfileBackend;
}

export class CloudDatabaseDriver {
  private backend:
    PlayerProfileBackend;

  private disposed =
    false;

  private lastError:
    string | null =
      null;

  public constructor(
    options:
      CloudDatabaseDriverOptions =
        {},
  ) {
    this.backend =
      options.backend ??
      new UnsupportedPlayerProfileBackend();
  }

  /** Troca o backend remoto (o anterior é descartado). */
  public setBackend(
    backend:
      PlayerProfileBackend | null,
  ): void {
    if (
      this.backend !==
        backend
    ) {
      this.backend.dispose?.();
    }

    this.backend =
      backend ??
      new UnsupportedPlayerProfileBackend();
  }

  /** true se há um backend real configurado. */
  public get isSupported():
    boolean {
    return this.backend.supported !==
      false;
  }

  /** Erro da última operação ("unsupported", mensagem do backend) ou null. */
  public getLastError():
    string | null {
    return this.lastError;
  }

  public async syncProfile(
    profile:
      PlayerOnlineProfile,
  ): Promise<boolean> {
    if (
      this.disposed
    ) {
      this.lastError =
        "disposed";

      return false;
    }

    if (
      !this.isSupported
    ) {
      this.lastError =
        "unsupported";

      return false;
    }

    try {
      await this.backend
        .write(
          cloneProfile(
            profile,
          ),
        );

      this.lastError =
        null;

      return true;
    } catch (
      error
    ) {
      this.lastError =
        error instanceof Error
          ? error.message
          : String(error);

      return false;
    }
  }

  public async fetchProfile(
    playerId: string,
  ): Promise<
    PlayerOnlineProfile | null
  > {
    if (
      this.disposed
    ) {
      this.lastError =
        "disposed";

      return null;
    }

    if (
      !this.isSupported
    ) {
      this.lastError =
        "unsupported";

      return null;
    }

    try {
      const profile =
        await this.backend
          .read(
            playerId,
          );

      this.lastError =
        null;

      return profile ===
        null
        ? null
        : cloneProfile(
            profile,
          );
    } catch (
      error
    ) {
      this.lastError =
        error instanceof Error
          ? error.message
          : String(error);

      return null;
    }
  }

  public dispose():
    void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.backend
      .dispose?.();
  }
}
