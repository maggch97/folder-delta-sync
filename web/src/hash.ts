import { sha256 } from "@noble/hashes/sha256";

const chunkSize = 4 * 1024 * 1024;

export async function sha256File(file: File, onChunk?: (bytes: number) => void): Promise<string> {
  const hasher = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    hasher.update(chunk);
    onChunk?.(chunk.byteLength);
    offset = end;
    await yieldToBrowser();
  }
  return toHex(hasher.digest());
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

