export function newId(prefix = ""): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  return prefix ? `${prefix}:${uuid}` : uuid;
}

function fallbackUuid(): string {
  // apenas para ambientes sem crypto.randomUUID
  const b = new Uint8Array(16);
  (globalThis.crypto?.getRandomValues ?? ((a: Uint8Array) => {
    for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  }))(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}