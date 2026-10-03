import type { PluginStorage } from "../../core/contracts/plugin-storage";
import { EntityManager } from "./EntityManager";
import { WorldStateSerializer } from "./WorldStateSerializer";

export class SaveSystem {
  public constructor(private readonly storage?: PluginStorage) {}

  public saveWorldSnapshot(slotKey: string, sceneId: string | null, entityManager: EntityManager): boolean {
    const serialized = WorldStateSerializer.serialize(sceneId, entityManager);
    const encryptedData = this.encrypt(serialized);

    if (this.storage) {
      this.storage.set(slotKey, encryptedData);
      console.log(`[SaveSystem] 💾 Estado de mundo gravado no PluginStorage (Slot: '${slotKey}').`);
    } else {
      localStorage.setItem(`world_save_${slotKey}`, encryptedData);
      console.log(`[SaveSystem] 💾 Estado de mundo gravado no LocalStorage (Slot: '${slotKey}').`);
    }

    return true;
  }

  public loadWorldSnapshot(slotKey: string, entityManager: EntityManager): boolean {
    let encryptedData: string | null = null;

    if (this.storage) {
      encryptedData = this.storage.get(slotKey);
    } else {
      encryptedData = localStorage.getItem(`world_save_${slotKey}`);
    }

    if (!encryptedData) return false;

    const decrypted = this.decrypt(encryptedData);
    return WorldStateSerializer.deserialize(decrypted, entityManager);
  }

  private encrypt(data: string): string {
    return btoa(encodeURIComponent(data));
  }

  private decrypt(encoded: string): string {
    return decodeURIComponent(atob(encoded));
  }
}