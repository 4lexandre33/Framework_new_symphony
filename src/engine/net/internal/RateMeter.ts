/**
 * Medidor de taxa em janela deslizante (10 baldes de 100 ms = 1 s).
 * Leitura NÃO destrutiva (G108): `perSecond()` pode ser chamado à vontade.
 * Sem alocação por amostra.
 */
export class RateMeter {
  private readonly buckets: Float64Array;
  private readonly bucketMs: number;
  private currentBucketStart = Number.NEGATIVE_INFINITY;
  private currentIndex = 0;
  private totalValue = 0;

  public constructor(
    private readonly now: () => number,
    bucketCount = 10,
    windowMs = 1000,
  ) {
    this.buckets = new Float64Array(Math.max(1, bucketCount));
    this.bucketMs = windowMs / this.buckets.length;
  }

  public add(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.advance();
    this.buckets[this.currentIndex] = (this.buckets[this.currentIndex] ?? 0) + value;
    this.totalValue += value;
  }

  /** Soma da janela (≈ valor por segundo). */
  public perSecond(): number {
    this.advance();
    let sum = 0;
    for (let index = 0; index < this.buckets.length; index += 1) {
      sum += this.buckets[index] ?? 0;
    }
    return sum;
  }

  /** Total acumulado desde a criação/reset. */
  public get total(): number {
    return this.totalValue;
  }

  public reset(): void {
    this.buckets.fill(0);
    this.currentBucketStart = Number.NEGATIVE_INFINITY;
    this.totalValue = 0;
  }

  private advance(): void {
    const now = this.now();
    if (this.currentBucketStart === Number.NEGATIVE_INFINITY) {
      this.currentBucketStart = now;
      return;
    }

    const elapsedBuckets = Math.floor((now - this.currentBucketStart) / this.bucketMs);
    if (elapsedBuckets <= 0) return;

    const steps = Math.min(elapsedBuckets, this.buckets.length);
    for (let step = 0; step < steps; step += 1) {
      this.currentIndex = (this.currentIndex + 1) % this.buckets.length;
      this.buckets[this.currentIndex] = 0;
    }
    this.currentBucketStart += elapsedBuckets * this.bucketMs;
  }
}
