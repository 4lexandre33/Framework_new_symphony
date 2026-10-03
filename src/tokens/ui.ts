import { defineCapability } from "../core/contracts/capability-token";
import type {
  UIScreenId,
  ModalConfig,
  PlayerHUDData,
} from "../contracts/ui/types";

export interface UIApi {
  readonly currentScreen: UIScreenId;
  readonly activeModalCount: number;
  readonly currentLocale: string;

  openScreen(screenId: UIScreenId): void;
  pushModal(config: ModalConfig): void;
  popModal(): boolean;

  bindHUDData(data: Partial<PlayerHUDData>): void;
  updateHUD(key: keyof PlayerHUDData, value: unknown): void;

  setLocale(locale: string): void;
  translate(key: string, params?: Record<string, string | number>): string;

  registerTemplate(templateId: string, htmlContent: string): void;
}

export const UIToken = defineCapability<UIApi>("game.ui", "1.0.0");