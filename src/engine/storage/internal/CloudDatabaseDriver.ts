import type {
  PlayerOnlineProfile,
} from "../../../contracts/storage/types";

export interface PlayerProfileBackend {
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
 * Backend local determinístico usado como default de compatibilidade.
 * Um BaaS real entra via PlayerProfileBackend; CloudDatabaseDriver não faz
 * fetch direto nem carrega credenciais no frontend.
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
  private readonly backend:
    PlayerProfileBackend;

  private disposed =
    false;

  public constructor(
    options:
      CloudDatabaseDriverOptions =
        {},
  ) {
    this.backend =
      options.backend ??
      new MemoryPlayerProfileBackend();
  }

  public async syncProfile(
    profile:
      PlayerOnlineProfile,
  ): Promise<boolean> {
    if (
      this.disposed
    ) {
      return false;
    }

    try {
      await this.backend
        .write(
          cloneProfile(
            profile,
          ),
        );

      return true;
    } catch {
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
      return null;
    }

    try {
      const profile =
        await this.backend
          .read(
            playerId,
          );

      return profile ===
        null
        ? null
        : cloneProfile(
            profile,
          );
    } catch {
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
