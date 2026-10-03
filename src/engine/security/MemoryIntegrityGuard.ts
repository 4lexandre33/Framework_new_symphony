import type { ProtectedValueDescriptor } from "../../contracts/security/types";

const FLOAT64_BYTES = 8;
const UINT32_HIGH_MANTISSA_MASK = 0x000f_ffff;
const FNV_OFFSET_BASIS = 0x811c_9dc5;
const FNV_PRIME = 0x0100_0193;

export class MemoryIntegrityGuard {
  private dynamicKey = createRandomUint32();
  private nonce = 1;

  private readonly scratchBuffer = new ArrayBuffer(FLOAT64_BYTES);
  private readonly scratchFloat64 = new Float64Array(this.scratchBuffer);
  private readonly scratchUint32 = new Uint32Array(this.scratchBuffer);

  public protectNumber(
    id: string,
    value: number,
  ): ProtectedValueDescriptor {
    if (id.length === 0) {
      throw new TypeError("O identificador da variável protegida não pode ser vazio.");
    }

    if (!Number.isFinite(value)) {
      throw new RangeError("Apenas números finitos podem ser protegidos.");
    }

    const key = this.createDescriptorKey(id);
    const obfuscatedValue = this.transformMantissa(value, key);
    const checksum = this.calculateChecksum(id, obfuscatedValue, key);

    return {
      id,
      obfuscatedValue,
      key,
      checksum,
    };
  }

  public readProtectedNumber(
    descriptor: ProtectedValueDescriptor,
  ): number | null {
    if (!this.verifyIntegrity(descriptor)) {
      return null;
    }

    const value = this.transformMantissa(
      descriptor.obfuscatedValue,
      descriptor.key,
    );

    return Number.isFinite(value) ? value : null;
  }

  public verifyIntegrity(
    descriptor: ProtectedValueDescriptor,
  ): boolean {
    if (
      descriptor.id.length === 0 ||
      !Number.isFinite(descriptor.obfuscatedValue) ||
      !Number.isInteger(descriptor.key) ||
      descriptor.key < 0 ||
      descriptor.key > 0xffff_ffff ||
      !Number.isInteger(descriptor.checksum) ||
      descriptor.checksum < 0 ||
      descriptor.checksum > 0xffff_ffff
    ) {
      return false;
    }

    const expectedChecksum = this.calculateChecksum(
      descriptor.id,
      descriptor.obfuscatedValue,
      descriptor.key,
    );

    return descriptor.checksum === expectedChecksum;
  }

  public checkSpeedhack(
    browserDeltaMs: number,
    osDeltaMs: number,
    toleranceRatio = 0.25,
  ): boolean {
    if (
      !Number.isFinite(browserDeltaMs) ||
      !Number.isFinite(osDeltaMs) ||
      !Number.isFinite(toleranceRatio) ||
      browserDeltaMs < 0 ||
      osDeltaMs <= 0 ||
      toleranceRatio < 0
    ) {
      return false;
    }

    const ratio = Math.abs(browserDeltaMs - osDeltaMs) / osDeltaMs;
    return ratio > toleranceRatio;
  }

  public rotateKey(): void {
    this.dynamicKey = createRandomUint32();
    this.nonce = 1;
  }

  private createDescriptorKey(id: string): number {
    let hash = this.dynamicKey ^ this.nonce;

    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME);
    }

    this.nonce = (this.nonce + 1) >>> 0;

    const normalized = hash >>> 0;
    return normalized === 0 ? 0xa5a5_5a5a : normalized;
  }

  private transformMantissa(value: number, key: number): number {
    this.scratchFloat64[0] = value;

    const lowWord = this.scratchUint32[0] ?? 0;
    const highWord = this.scratchUint32[1] ?? 0;

    const highMantissaMask =
      rotateLeft32(key, 13) & UINT32_HIGH_MANTISSA_MASK;

    this.scratchUint32[0] = (lowWord ^ key) >>> 0;
    this.scratchUint32[1] = (highWord ^ highMantissaMask) >>> 0;

    return this.scratchFloat64[0] ?? 0;
  }

  private calculateChecksum(
    id: string,
    obfuscatedValue: number,
    key: number,
  ): number {
    let hash = FNV_OFFSET_BASIS;

    for (let index = 0; index < id.length; index += 1) {
      const code = id.charCodeAt(index);
      hash = fnvMixByte(hash, code & 0xff);
      hash = fnvMixByte(hash, (code >>> 8) & 0xff);
    }

    hash = mixUint32(hash, key >>> 0);

    this.scratchFloat64[0] = obfuscatedValue;

    hash = mixUint32(hash, this.scratchUint32[0] ?? 0);
    hash = mixUint32(hash, this.scratchUint32[1] ?? 0);

    return hash >>> 0;
  }
}

function createRandomUint32(): number {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);

    const randomValue = value[0] ?? 0;
    return randomValue === 0 ? 1 : randomValue;
  }

  const fallback = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
  return fallback === 0 ? 1 : fallback;
}

function rotateLeft32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function fnvMixByte(hash: number, byte: number): number {
  return Math.imul((hash ^ byte) >>> 0, FNV_PRIME) >>> 0;
}

function mixUint32(hash: number, value: number): number {
  let result = hash;
  result = fnvMixByte(result, value & 0xff);
  result = fnvMixByte(result, (value >>> 8) & 0xff);
  result = fnvMixByte(result, (value >>> 16) & 0xff);
  result = fnvMixByte(result, (value >>> 24) & 0xff);
  return result >>> 0;
}
