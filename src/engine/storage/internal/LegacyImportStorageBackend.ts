import type {
  AsyncKeyValueStorageBackend,
  KeyValueStorageBackend,
} from "./KeyValueStorageBackend";

/** Marcador gravado no destino depois da importação (fora dos prefixos de save). */
export const LEGACY_IMPORT_MARKER_KEY =
  "__engine_storage_legacy_import_v1";

/** Chaves de save da engine: `[ns:<x>:]local_db_save_…` / `steam_cloud_save_…`. */
export const ENGINE_SAVE_KEY_PATTERN =
  /^(?:ns:[^:]*:)?(?:local_db_save_|steam_cloud_save_)/u;

/** Resultado da importação (diagnóstico; também gravado no marcador). */
export interface LegacyImportReport {
  /** Chaves de save encontradas no `localStorage`. */
  readonly found: number;
  readonly imported: number;
  /** Já existiam no destino (não sobrescritas). */
  readonly skipped: number;
  /** Chaves que falharam (o resto foi importado mesmo assim). */
  readonly failedKeys: ReadonlyArray<string>;
}

/**
 * Envolve um backend assíncrono novo (IndexedDB / arquivo) e, na PRIMEIRA
 * operação, copia para ele os saves que versões anteriores gravaram no
 * `localStorage` (G102): quem atualiza a engine não perde os saves.
 *
 * - Copia só chaves de save da engine e só as que o destino ainda não tem.
 * - NÃO apaga o `localStorage` (rollback seguro); grava um marcador para não
 *   repetir. Falha na importação é registrada e não bloqueia o jogo.
 * - Cada chave é importada isoladamente: uma chave que falha (ex.: inválida
 *   para o destino) não impede as outras, e o marcador é gravado mesmo
 *   assim, listando as que falharam (`getImportReport()`). Elas continuam no
 *   `localStorage` para recuperação manual.
 */
export class LegacyImportStorageBackend
  implements AsyncKeyValueStorageBackend {
  private importing: Promise<void> | null = null;
  private report: LegacyImportReport | null = null;

  public constructor(
    private readonly target: AsyncKeyValueStorageBackend,
    private readonly legacy: KeyValueStorageBackend | null,
  ) {}

  /** Relatório da importação desta sessão (null se não houve/ainda não rodou). */
  public getImportReport(): LegacyImportReport | null {
    return this.report;
  }

  private ensureImported(): Promise<void> {
    if (this.importing === null) {
      this.importing = this.importLegacy().catch((error: unknown) => {
        console.warn("[Storage] Importação de saves do localStorage falhou:", error);
      });
    }

    return this.importing;
  }

  private async importLegacy(): Promise<void> {
    const legacy = this.legacy;

    if (legacy === null) {
      return;
    }

    if ((await this.target.getItem(LEGACY_IMPORT_MARKER_KEY)) !== null) {
      return;
    }

    const legacyKeys: string[] = [];
    const length = legacy.length;

    for (let index = 0; index < length; index += 1) {
      const key = legacy.key(index);

      if (key !== null && ENGINE_SAVE_KEY_PATTERN.test(key)) {
        legacyKeys.push(key);
      }
    }

    let imported = 0;
    let skipped = 0;
    const failedKeys: string[] = [];

    if (legacyKeys.length > 0) {
      const existing = new Set(await this.target.keys());

      for (const key of legacyKeys) {
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }

        try {
          const value = legacy.getItem(key);

          if (value !== null) {
            await this.target.setItem(key, value);
            imported += 1;
          }
        } catch (error: unknown) {
          failedKeys.push(key);
          console.warn(`[Storage] Save legado '${key}' não foi importado (fica no localStorage):`, error);
        }
      }
    }

    this.report = {
      found: legacyKeys.length,
      imported,
      skipped,
      failedKeys,
    };

    // Marcador mesmo com falhas parciais: não repete a cópia a cada boot.
    await this.target.setItem(
      LEGACY_IMPORT_MARKER_KEY,
      JSON.stringify({
        importedKeys: legacyKeys.length,
        imported,
        skipped,
        failedKeys,
      }),
    );
  }

  public async getItem(key: string): Promise<string | null> {
    await this.ensureImported();
    return await this.target.getItem(key);
  }

  public async setItem(key: string, value: string): Promise<void> {
    await this.ensureImported();
    await this.target.setItem(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    await this.ensureImported();
    await this.target.removeItem(key);
  }

  public async keys(): Promise<string[]> {
    await this.ensureImported();
    const keys = await this.target.keys();
    return keys.filter((key) => key !== LEGACY_IMPORT_MARKER_KEY);
  }

  public dispose(): void {
    this.target.dispose?.();
  }
}
