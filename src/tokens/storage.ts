import { defineCapability } from "@core";
import type {
  StorageDriverType,
  SaveGameMetadata,
  PlayerOnlineProfile,
} from "../contracts/storage/types";

export interface StorageApi {
  /**
   * Driver ativo no momento para operações padrão.
   */
  readonly activeDriver: StorageDriverType;

  /**
   * Salva o estado do jogo em um slot específico.
   */
  saveGame(
    slotName: string,
    data: Record<string, unknown>,
    driverPreference?: StorageDriverType
  ): Promise<SaveGameMetadata>;

  /**
   * Carrega os dados de um slot salvo.
   */
  loadGame<T = Record<string, unknown>>(
    slotName: string,
    driverPreference?: StorageDriverType
  ): Promise<T | null>;

  /**
   * Lista os metadados de todos os salvamentos disponíveis.
   */
  listSaves(driverPreference?: StorageDriverType): Promise<SaveGameMetadata[]>;

  /**
   * Remove permanentemente um arquivo de save.
   */
  deleteSave(slotName: string, driverPreference?: StorageDriverType): Promise<boolean>;

  /**
   * Sincroniza o perfil online do jogador com o banco de dados remoto.
   */
  syncOnlineProfile(profile: PlayerOnlineProfile): Promise<boolean>;

  /**
   * Busca o perfil online atualizado do jogador.
   */
  fetchOnlineProfile(playerId: string): Promise<PlayerOnlineProfile | null>;

  /**
   * Define o driver principal ativo do sistema de salvamento.
   */
  setDriver(driverType: StorageDriverType): void;
}

export const StorageToken = defineCapability<StorageApi>("game.storage", "1.0.0");