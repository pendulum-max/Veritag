import { sha256 } from "@veritag/sdk";

export interface StoredObjectResult {
  hash: string;
  storageKey: string;
  size: number;
}

export interface ObjectStorageAdapter {
  put(content: Uint8Array, mime: string): Promise<StoredObjectResult>;
  get(storageKey: string): Promise<Uint8Array | null>;
}

/**
 * Content-addressed storage adapter computing SHA-256 hashes compatible with
 * Soroban `BytesN<32>` report/receipt hashes.
 */
export class ContentAddressedMemoryStorage implements ObjectStorageAdapter {
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly bucket: string;

  constructor(bucket = "veritag-files") {
    this.bucket = bucket;
  }

  async put(content: Uint8Array, _mime: string): Promise<StoredObjectResult> {
    const hash = sha256(content).toString("hex");
    const storageKey = `${this.bucket}/${hash.slice(0, 2)}/${hash}`;
    if (!this.blobs.has(storageKey)) {
      this.blobs.set(storageKey, new Uint8Array(content));
    }
    return {
      hash,
      storageKey,
      size: content.byteLength,
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    return this.blobs.get(storageKey) ?? null;
  }
}
