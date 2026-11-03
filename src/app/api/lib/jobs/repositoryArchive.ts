import { get } from "@vercel/blob";

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export async function downloadRepositoryArchive(
  pathname: string,
): Promise<Buffer> {
  if (
    !pathname ||
    !pathname.startsWith("repository-uploads/") ||
    !pathname.endsWith(".zip")
  ) {
    throw new Error("Invalid repository archive pathname");
  }

  const result = await get(pathname, { access: "private" });

  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Repository archive not found in private Blob storage");
  }

  const expectedSize = result.blob.size;

  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_ARCHIVE_BYTES
  ) {
    throw new Error("Repository archive has an invalid or excessive size");
  }

  const buffer = Buffer.allocUnsafe(expectedSize);
  let downloadedBytes = 0;

  const reader = result.stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (!value || value.byteLength === 0) continue;

      const nextSize = downloadedBytes + value.byteLength;

      if (nextSize > expectedSize || nextSize > MAX_ARCHIVE_BYTES) {
        throw new Error("Repository archive exceeded its declared size");
      }

      buffer.set(value, downloadedBytes);
      downloadedBytes = nextSize;
    }

    if (downloadedBytes !== expectedSize) {
      throw new Error("Downloaded archive size does not match Blob metadata");
    }

    return buffer;
  } catch (error) {
    buffer.fill(0);

    try {
      await reader.cancel();
    } catch {
      // Preserve the original download error.
    }

    throw error;
  } finally {
    reader.releaseLock();
  }
}
