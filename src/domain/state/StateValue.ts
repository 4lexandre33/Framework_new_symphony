export type StatePrimitive =
  | null
  | boolean
  | number
  | string;

export type StateValue =
  | StatePrimitive
  | readonly StateValue[]
  | {
      readonly [key: string]:
        StateValue;
    };

export type StateValueErrorCode =
  | "unsupported-type"
  | "non-finite-number"
  | "non-plain-object"
  | "cyclic-value";

export class StateValueError
  extends Error {
  public readonly name =
    "StateValueError";

  public constructor(
    public readonly code:
      StateValueErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isPlainObject(
  value: object,
): boolean {
  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function cloneObject(
  source:
    Record<
      string,
      unknown
    >,
  stack:
    Set<object>,
): {
  readonly [key: string]:
    StateValue;
} {
  if (stack.has(source)) {
    throw new StateValueError(
      "cyclic-value",
      "StateValue não pode conter referências cíclicas.",
    );
  }

  stack.add(source);

  try {
    const target:
      Record<
        string,
        StateValue
      > = {};

    const keys =
      Object.keys(source)
        .sort();

    for (const key of keys) {
      const cloned =
        cloneStateValueInternal(
          source[key],
          stack,
        );

      Object.defineProperty(
        target,
        key,
        {
          value: cloned,
          enumerable: true,
          configurable: false,
          writable: false,
        },
      );
    }

    return Object.freeze(
      target,
    );
  } finally {
    stack.delete(source);
  }
}

function cloneArray(
  source:
    readonly unknown[],
  stack:
    Set<object>,
): readonly StateValue[] {
  if (stack.has(source)) {
    throw new StateValueError(
      "cyclic-value",
      "StateValue não pode conter referências cíclicas.",
    );
  }

  stack.add(source);

  try {
    const target:
      StateValue[] = [];

    for (
      let index = 0;
      index <
      source.length;
      index += 1
    ) {
      target.push(
        cloneStateValueInternal(
          source[index],
          stack,
        ),
      );
    }

    return Object.freeze(
      target,
    );
  } finally {
    stack.delete(source);
  }
}

function cloneStateValueInternal(
  value: unknown,
  stack:
    Set<object>,
): StateValue {
  if (
    value === null ||
    typeof value ===
      "boolean" ||
    typeof value ===
      "string"
  ) {
    return value;
  }

  if (
    typeof value ===
    "number"
  ) {
    if (
      !Number.isFinite(value)
    ) {
      throw new StateValueError(
        "non-finite-number",
        "StateValue number deve ser finito.",
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return cloneArray(
      value,
      stack,
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    if (
      !isPlainObject(value)
    ) {
      throw new StateValueError(
        "non-plain-object",
        "StateValue object deve ser um objeto simples, sem prototype de classe/Date/Map/Set.",
      );
    }

    return cloneObject(
      value as Record<
        string,
        unknown
      >,
      stack,
    );
  }

  throw new StateValueError(
    "unsupported-type",
    `Tipo não suportado em StateValue: ${typeof value}.`,
  );
}

/**
 * Valida, copia profundamente e congela um valor de State.
 *
 * Isso impede que referências fornecidas pelo chamador alterem o StateStore
 * depois de set(). O valor retornado continua serializável por JSON.
 */
export function cloneStateValue(
  value: unknown,
): StateValue {
  return cloneStateValueInternal(
    value,
    new Set<object>(),
  );
}

export function isStateValue(
  value: unknown,
): value is StateValue {
  try {
    cloneStateValue(value);
    return true;
  } catch {
    return false;
  }
}

export function stateValueEquals(
  left: StateValue,
  right: StateValue,
): boolean {
  if (left === right) {
    return true;
  }

  if (
    typeof left !==
      typeof right
  ) {
    return false;
  }

  if (
    left === null ||
    right === null
  ) {
    return false;
  }

  if (
    Array.isArray(left)
  ) {
    if (
      !Array.isArray(right) ||
      left.length !==
        right.length
    ) {
      return false;
    }

    for (
      let index = 0;
      index <
      left.length;
      index += 1
    ) {
      const leftValue =
        left[index];

      const rightValue =
        right[index];

      if (
        leftValue ===
          undefined ||
        rightValue ===
          undefined ||
        !stateValueEquals(
          leftValue,
          rightValue,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  if (
    Array.isArray(right)
  ) {
    return false;
  }

  if (
    typeof left ===
      "object" &&
    typeof right ===
      "object"
  ) {
    const leftObject =
      left as Readonly<
        Record<
          string,
          StateValue
        >
      >;

    const rightObject =
      right as Readonly<
        Record<
          string,
          StateValue
        >
      >;

    const leftKeys =
      Object.keys(
        leftObject,
      );

    const rightKeys =
      Object.keys(
        rightObject,
      );

    if (
      leftKeys.length !==
      rightKeys.length
    ) {
      return false;
    }

    for (
      const key of leftKeys
    ) {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            rightObject,
            key,
          )
      ) {
        return false;
      }

      const leftValue =
        leftObject[key];

      const rightValue =
        rightObject[key];

      if (
        leftValue ===
          undefined ||
        rightValue ===
          undefined ||
        !stateValueEquals(
          leftValue,
          rightValue,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  return false;
}
