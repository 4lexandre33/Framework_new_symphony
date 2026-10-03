export interface ConfigField {
  readonly key: string;
  readonly kind: "string" | "number" | "boolean" | "select" | "json";
  readonly label?: string;
  readonly description?: string;
  readonly options?: readonly string[];
}

export interface ConfigSchema<T> {
  /** valida e normaliza. lança se inválido. */
  parse(raw: unknown): T;
  readonly defaults: T;
  readonly fields?: readonly ConfigField[];
}

export function defineConfig<T extends Record<string, unknown>>(spec: {
  defaults: T;
  fields?: readonly ConfigField[];
  parse?: (raw: unknown) => T;
}): ConfigSchema<T> {
  return {
    defaults: spec.defaults,
    fields: spec.fields,
    parse(raw) {
      if (spec.parse) return spec.parse(raw);
      const input = (raw ?? {}) as Partial<T>;
      return { ...spec.defaults, ...input };
    },
  };
}