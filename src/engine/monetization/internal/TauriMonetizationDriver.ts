import {
  invoke,
} from "@tauri-apps/api/core";

import type {
  SteamInventoryItemDTO,
  TransactionReceiptDTO,
} from "../../../contracts/monetization/types";

const SKU_PATTERN =
  /^[A-Za-z0-9_.:-]{1,128}$/u;

const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9_.:-]{1,128}$/u;

const MAX_AMOUNT_CENTS =
  100_000_000_000;

const MAX_CONSUME_QUANTITY =
  1_000_000;

function isTauriRuntime(): boolean {
  return (
    "__TAURI_INTERNALS__" in
    globalThis
  );
}

function isValidAmount(
  amountCents:
    number,
): boolean {
  return (
    Number.isSafeInteger(
      amountCents,
    ) &&
    amountCents >
      0 &&
    amountCents <=
      MAX_AMOUNT_CENTS
  );
}

function isValidQuantity(
  quantity:
    number,
): boolean {
  return (
    Number.isSafeInteger(
      quantity,
    ) &&
    quantity >
      0 &&
    quantity <=
      MAX_CONSUME_QUANTITY
  );
}

export class TauriMonetizationDriver {
  public async initPurchase(
    sku:
      string,
    amountCents:
      number,
  ): Promise<
    TransactionReceiptDTO |
    null
  > {
    const normalizedSku =
      sku.trim();

    if (
      !SKU_PATTERN.test(
        normalizedSku,
      ) ||
      !isValidAmount(
        amountCents,
      ) ||
      !isTauriRuntime()
    ) {
      return null;
    }

    try {
      return await invoke<
        TransactionReceiptDTO
      >(
        "monetization_init_purchase",
        {
          sku:
            normalizedSku,

          amountCents,
        },
      );
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[TauriMonetizationDriver] initPurchase recusada pelo boundary nativo:",
        error,
      );

      return null;
    }
  }

  public async finalizePurchase(
    orderId:
      string,
  ): Promise<boolean> {
    const normalizedOrderId =
      orderId.trim();

    if (
      !IDENTIFIER_PATTERN.test(
        normalizedOrderId,
      ) ||
      !isTauriRuntime()
    ) {
      return false;
    }

    try {
      return await invoke<boolean>(
        "monetization_finalize_purchase",
        {
          orderId:
            normalizedOrderId,
        },
      );
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[TauriMonetizationDriver] finalizePurchase recusada pelo boundary nativo:",
        error,
      );

      return false;
    }
  }

  public async fetchSteamInventory():
    Promise<
      ReadonlyArray<
        SteamInventoryItemDTO
      >
    > {
    if (
      !isTauriRuntime()
    ) {
      return [];
    }

    try {
      return await invoke<
        ReadonlyArray<
          SteamInventoryItemDTO
        >
      >(
        "monetization_fetch_inventory",
      );
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[TauriMonetizationDriver] fetchSteamInventory falhou em modo fail-closed:",
        error,
      );

      return [];
    }
  }

  public async consumeSteamItem(
    itemId:
      string,
    quantity:
      number,
  ): Promise<boolean> {
    const normalizedItemId =
      itemId.trim();

    if (
      !IDENTIFIER_PATTERN.test(
        normalizedItemId,
      ) ||
      !isValidQuantity(
        quantity,
      ) ||
      !isTauriRuntime()
    ) {
      return false;
    }

    try {
      return await invoke<boolean>(
        "monetization_consume_item",
        {
          itemId:
            normalizedItemId,

          quantity,
        },
      );
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[TauriMonetizationDriver] consumeSteamItem recusado pelo boundary nativo:",
        error,
      );

      return false;
    }
  }
}
