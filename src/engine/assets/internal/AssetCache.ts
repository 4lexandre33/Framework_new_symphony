import type {
  AssetType,
} from "../../../contracts/assets/types";

import type {
  CachedAssetRecord,
} from "../../../tokens/assets";

interface DisposableLike {
  dispose(): void;
}

interface TraversableLike {
  traverse(
    callback:
      (
        value:
          unknown,
      ) => void,
  ): void;
}

interface SceneLike {
  readonly scene?:
    TraversableLike;
}

function hasDispose(
  value:
    unknown,
): value is
  DisposableLike {
  if (
    value ===
      null ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  return (
    "dispose" in
      value &&
    typeof (
      value as {
        dispose?:
          unknown;
      }
    ).dispose ===
      "function"
  );
}

function getObjectProperty(
  value:
    unknown,
  key:
    string,
): unknown {
  if (
    value ===
      null ||
    typeof value !==
      "object"
  ) {
    return undefined;
  }

  return (
    value as
      Record<
        string,
        unknown
      >
  )[
    key
  ];
}

function hasTraverse(
  value:
    unknown,
): value is
  TraversableLike {
  return (
    value !==
      null &&
    typeof value ===
      "object" &&
    "traverse" in
      value &&
    typeof (
      value as {
        traverse?:
          unknown;
      }
    ).traverse ===
      "function"
  );
}

export class AssetCache {
  private readonly cache =
    new Map<
      string,
      CachedAssetRecord<unknown>
    >();

  public has(
    key:
      string,
  ): boolean {
    return this.cache.has(
      key,
    );
  }

  public get<T = unknown>(
    key:
      string,
  ): T |
    null {
    const record =
      this.cache.get(
        key,
      );

    if (
      record ===
      undefined
    ) {
      return null;
    }

    return record.data as
      T;
  }

  public set<T>(
    key:
      string,
    data:
      T,
    type:
      AssetType,
  ): void {
    const existing =
      this.cache.get(
        key,
      );

    if (
      existing !==
      undefined
    ) {
      existing.refCount +=
        1;

      return;
    }

    this.cache.set(
      key,
      {
        data,
        type,
        refCount:
          1,
      },
    );
  }

  public retain(
    key:
      string,
  ): boolean {
    const record =
      this.cache.get(
        key,
      );

    if (
      record ===
      undefined
    ) {
      return false;
    }

    record.refCount +=
      1;

    return true;
  }

  public release(
    key:
      string,
  ): boolean {
    const record =
      this.cache.get(
        key,
      );

    if (
      record ===
      undefined
    ) {
      return false;
    }

    record.refCount -=
      1;

    if (
      record.refCount >
      0
    ) {
      return false;
    }

    this.disposeResource(
      record.data,
      record.type,
    );

    this.cache.delete(
      key,
    );

    return true;
  }

  public getRefCount(
    key:
      string,
  ): number {
    return (
      this.cache.get(
        key,
      )?.refCount ??
      0
    );
  }

  public get size():
    number {
    return this.cache.size;
  }

  /** Chaves e refCounts atuais (cópia; não usar em hot path). */
  public snapshot(): Array<{ readonly key: string; readonly refCount: number }> {
    const result: Array<{ readonly key: string; readonly refCount: number }> = [];

    for (const [key, record] of this.cache) {
      result.push({ key, refCount: record.refCount });
    }

    return result;
  }

  /** Libera só registros sem referência viva (refCount <= 0). Devolve quantos. */
  public releaseUnreferenced(): number {
    let freed = 0;

    for (const [key, record] of this.cache) {
      if (record.refCount <= 0) {
        this.disposeResource(record.data, record.type);
        this.cache.delete(key);
        freed += 1;
      }
    }

    return freed;
  }

  public clear(): void {
    for (
      const record of
      this.cache.values()
    ) {
      this.disposeResource(
        record.data,
        record.type,
      );
    }

    this.cache.clear();
  }

  private disposeResource(
    data:
      unknown,
    type:
      AssetType,
  ): void {
    if (
      data ===
        null ||
      data ===
        undefined
    ) {
      return;
    }

    if (
      type ===
      "texture"
    ) {
      if (
        hasDispose(
          data,
        )
      ) {
        data.dispose();
      }

      return;
    }

    if (
      type !==
      "gltf"
    ) {
      return;
    }

    const scene =
      (
        data as
          SceneLike
      ).scene;

    if (
      !hasTraverse(
        scene,
      )
    ) {
      return;
    }

    const disposedResources =
      new Set<
        unknown
      >();

    const disposeOnce =
      (
        value:
          unknown,
      ): void => {
        if (
          !hasDispose(
            value,
          ) ||
        disposedResources.has(
          value,
        )
        ) {
          return;
        }

        disposedResources.add(
          value,
        );

        value.dispose();
      };

    scene.traverse(
      (
        object:
          unknown,
      ): void => {
        disposeOnce(
          getObjectProperty(
            object,
            "geometry",
          ),
        );

        const material =
          getObjectProperty(
            object,
            "material",
          );

        if (
          Array.isArray(
            material,
          )
        ) {
          for (
            const entry of
            material
          ) {
            this.disposeMaterialResources(
              entry,
              disposeOnce,
            );
          }

          return;
        }

        this.disposeMaterialResources(
          material,
          disposeOnce,
        );
      },
    );
  }

  private disposeMaterialResources(
    material:
      unknown,
    disposeOnce:
      (
        value:
          unknown,
      ) => void,
  ): void {
    if (
      material ===
        null ||
      typeof material !==
        "object"
    ) {
      return;
    }

    for (
      const value of
      Object.values(
        material as
          Record<
            string,
            unknown
          >,
      )
    ) {
      if (
        value !==
          material
      ) {
        disposeOnce(
          value,
        );
      }
    }

    disposeOnce(
      material,
    );
  }
}
