import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
 * Content-addressed in-memory storage adapter computing SHA-256 hashes compatible with
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

/**
 * Content-addressed local disk storage adapter persisting files under `.data/storage/`.
 */
export class LocalDiskObjectStorage implements ObjectStorageAdapter {
  private readonly rootDir: string;
  private readonly bucket: string;

  constructor(rootDir = ".data/storage", bucket = "veritag-files") {
    this.rootDir = rootDir;
    this.bucket = bucket;
  }

  private resolvePath(storageKey: string): string {
    const sanitized = storageKey.replace(/\.\./g, "");
    return join(this.rootDir, sanitized);
  }

  async put(content: Uint8Array, _mime: string): Promise<StoredObjectResult> {
    const hash = sha256(content).toString("hex");
    const storageKey = `${this.bucket}/${hash.slice(0, 2)}/${hash}`;
    const fullPath = this.resolvePath(storageKey);
    if (!existsSync(fullPath)) {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }
    return {
      hash,
      storageKey,
      size: content.byteLength,
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const fullPath = this.resolvePath(storageKey);
    if (!existsSync(fullPath)) return null;
    return new Uint8Array(readFileSync(fullPath));
  }
}

/**
 * S3-compatible HTTP object storage adapter with local disk fallback.
 */
export class S3CompatibleObjectStorage implements ObjectStorageAdapter {
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly fallback: LocalDiskObjectStorage;
  private readonly fetchImpl: typeof fetch;

  constructor(params: {
    endpoint: string;
    bucket: string;
    localFallbackDir?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = params.endpoint.replace(/\/+$/, "");
    this.bucket = params.bucket;
    this.fallback = new LocalDiskObjectStorage(
      params.localFallbackDir ?? ".data/storage",
      params.bucket,
    );
    this.fetchImpl = params.fetchImpl ?? fetch;
  }

  async put(content: Uint8Array, mime: string): Promise<StoredObjectResult> {
    const hash = sha256(content).toString("hex");
    const storageKey = `${this.bucket}/${hash.slice(0, 2)}/${hash}`;
    try {
      const res = await this.fetchImpl(`${this.endpoint}/${storageKey}`, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: Buffer.from(content),
      });
      if (res.ok) {
        await this.fallback.put(content, mime);
        return { hash, storageKey, size: content.byteLength };
      }
    } catch {
      // Fall back to local disk when S3 endpoint is unavailable
    }
    return this.fallback.put(content, mime);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const local = await this.fallback.get(storageKey);
    if (local) return local;
    try {
      const res = await this.fetchImpl(`${this.endpoint}/${storageKey}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}
