/**
 * Contrato mínimo de schema. Compatível com Zod (`z.object({...})`),
 * Valibot, ArkType, ou qualquer parser que exponha `.parse()`.
 *
 * O kernel nunca impõe uma lib de schema — apenas consome esta interface.
 */
export interface Schema<T> {
  parse(raw: unknown): T;
}