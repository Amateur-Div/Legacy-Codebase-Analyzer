import * as yauzl from "yauzl";

export interface RepositoryFileReadResult {
  size: number;
  buffer?: Buffer;
}

export interface RepositoryReader {
  readonly files: string[];
  readFile(
    relativePath: string,
    maxBytes: number,
  ): Promise<RepositoryFileReadResult>;
  close(): Promise<void>;
}

export interface RepositoryReaderOptions {
  maxEntries?: number;
  maxTotalUncompressedBytes?: number;
  maxCompressionRatio?: number;
  ignoredDirectories?: Set<string>;
}

const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 200;

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

function normalizeEntryPath(fileName: string): string | null {
  if (!fileName || fileName.includes("\0")) return null;

  const normalized = fileName.replace(/\\/g, "/");

  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return null;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => segment === "..")) {
    return null;
  }

  const cleanSegments = segments.filter(
    (segment) => segment !== "" && segment !== ".",
  );

  if (cleanSegments.length === 0) return null;

  return cleanSegments.join("/");
}

function isSymlink(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;

  return fileType === 0o120000;
}

function isIgnoredPath(
  relativePath: string,
  ignoredDirectories: Set<string>,
): boolean {
  const segments = relativePath.split("/");

  return segments
    .slice(0, -1)
    .some((segment) => ignoredDirectories.has(segment));
}

function openZipFile(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error) {
          reject(error);
          return;
        }

        if (!zipFile) {
          reject(new Error("Unable to open ZIP archive"));
          return;
        }

        resolve(zipFile);
      },
    );
  });
}

function readEntryBuffer(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      if (!stream) {
        reject(new Error(`Unable to read ZIP entry: ${entry.fileName}`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      stream.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;

        if (totalBytes > maxBytes) {
          stream.destroy(
            new Error(`ZIP entry exceeded read limit: ${entry.fileName}`),
          );
          return;
        }

        chunks.push(chunk);
      });

      stream.on("error", reject);

      stream.on("end", () => {
        resolve(Buffer.concat(chunks, totalBytes));
      });
    });
  });
}

export async function createRepositoryReader(
  buffer: Buffer,
  options: RepositoryReaderOptions = {},
): Promise<RepositoryReader> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxTotalBytes =
    options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxCompressionRatio =
    options.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO;

  const ignoredDirectories =
    options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;

  const zipFile = await openZipFile(buffer);

  const entries = new Map<string, yauzl.Entry>();
  const files: string[] = [];

  let entryCount = 0;
  let totalUncompressedBytes = 0;
  let closed = false;

  const close = async () => {
    if (closed) return;

    closed = true;

    try {
      zipFile.close();
    } catch {}

    entries.clear();
    files.length = 0;

    buffer.fill(0);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;

        settled = true;
        reject(error);
      };

      zipFile.on("error", fail);

      zipFile.on("end", () => {
        if (settled) return;

        settled = true;
        resolve();
      });

      zipFile.on("entry", (entry: yauzl.Entry) => {
        if (settled) return;

        try {
          entryCount += 1;

          if (entryCount > maxEntries) {
            throw new Error(
              `ZIP contains too many entries (limit: ${maxEntries})`,
            );
          }

          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            throw new Error("Encrypted ZIP entries are not supported");
          }

          const relativePath = normalizeEntryPath(entry.fileName);

          if (!relativePath) {
            throw new Error(`Unsafe ZIP entry path: ${entry.fileName}`);
          }

          if (entry.fileName.endsWith("/")) {
            zipFile.readEntry();
            return;
          }

          if (isSymlink(entry)) {
            throw new Error(`Symbolic links are not allowed: ${relativePath}`);
          }

          if (
            !Number.isSafeInteger(entry.uncompressedSize) ||
            entry.uncompressedSize < 0 ||
            !Number.isSafeInteger(entry.compressedSize) ||
            entry.compressedSize < 0
          ) {
            throw new Error(`Invalid ZIP entry size: ${relativePath}`);
          }

          totalUncompressedBytes += entry.uncompressedSize;

          if (totalUncompressedBytes > maxTotalBytes) {
            throw new Error("ZIP expanded size exceeds the configured limit");
          }

          if (entry.uncompressedSize > 0) {
            if (entry.compressedSize === 0) {
              throw new Error(`Invalid compression size: ${relativePath}`);
            }

            const ratio = entry.uncompressedSize / entry.compressedSize;

            if (ratio > maxCompressionRatio) {
              throw new Error(`Suspicious compression ratio: ${relativePath}`);
            }
          }

          if (isIgnoredPath(relativePath, ignoredDirectories)) {
            zipFile.readEntry();
            return;
          }

          if (entries.has(relativePath)) {
            throw new Error(`Duplicate ZIP entry path: ${relativePath}`);
          }

          entries.set(relativePath, entry);
          files.push(relativePath);

          zipFile.readEntry();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Failed to process ZIP entry"),
          );
        }
      });

      zipFile.readEntry();
    });

    return {
      files,

      async readFile(relativePath, maxBytes) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
          throw new Error("maxBytes must be a non-negative safe integer");
        }

        if (closed) {
          throw new Error("Repository reader is already closed");
        }

        const entry = entries.get(relativePath);

        if (!entry) {
          throw new Error(`Repository file not found: ${relativePath}`);
        }

        const size = entry.uncompressedSize;

        if (size > maxBytes) {
          return { size };
        }

        const buffer = await readEntryBuffer(zipFile, entry, maxBytes);

        return { size, buffer };
      },

      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
