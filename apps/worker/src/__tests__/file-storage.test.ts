import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateFile,
  calculateFileHash,
  generateFileKey,
  compressMetadata,
  decompressMetadata,
  ALLOWED_MIME_TYPES,
} from "../lib/file-storage-enhanced";

describe("File Storage Enhancement", () => {
  describe("validateFile", () => {
    it("should accept valid image files", () => {
      const data = new ArrayBuffer(1024 * 100); // 100KB
      const result = validateFile(data, "image/jpeg");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept valid video files", () => {
      const data = new ArrayBuffer(1024 * 1024 * 10); // 10MB
      const result = validateFile(data, "video/mp4");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject empty files", () => {
      const data = new ArrayBuffer(0);
      const result = validateFile(data, "image/jpeg");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject files exceeding size limit", () => {
      const data = new ArrayBuffer(51 * 1024 * 1024); // 51MB (exceeds 50MB limit)
      const result = validateFile(data, "image/jpeg");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum size");
    });

    it("should reject unsupported MIME types", () => {
      const data = new ArrayBuffer(1024);
      const result = validateFile(data, "application/x-executable");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("should list all allowed MIME types in error message", () => {
      const data = new ArrayBuffer(1024);
      const result = validateFile(data, "application/x-unknown");
      expect(result.error).toContain("Allowed types");
      for (const mimeType of Array.from(ALLOWED_MIME_TYPES)) {
        expect(result.error).toContain(mimeType);
      }
    });
  });

  describe("calculateFileHash", () => {
    it("should calculate consistent SHA-256 hash", async () => {
      const data = new ArrayBuffer(100);
      const view = new Uint8Array(data);
      view.fill(42);

      const hash1 = await calculateFileHash(data);
      const hash2 = await calculateFileHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 is 64 hex characters
    });

    it("should produce different hashes for different data", async () => {
      const data1 = new ArrayBuffer(100);
      const view1 = new Uint8Array(data1);
      view1.fill(42);

      const data2 = new ArrayBuffer(100);
      const view2 = new Uint8Array(data2);
      view2.fill(43);

      const hash1 = await calculateFileHash(data1);
      const hash2 = await calculateFileHash(data2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("generateFileKey", () => {
    it("should generate unique keys for multiple calls", () => {
      const key1 = generateFileKey("user123", "image/jpeg");
      const key2 = generateFileKey("user123", "image/jpeg");

      expect(key1).not.toBe(key2);
    });

    it("should include correct file extension based on MIME type", () => {
      expect(generateFileKey("user123", "image/jpeg")).toMatch(/\.jpg$/);
      expect(generateFileKey("user123", "image/png")).toMatch(/\.png$/);
      expect(generateFileKey("user123", "video/mp4")).toMatch(/\.mp4$/);
    });

    it("should sanitize user ID in key", () => {
      const key = generateFileKey("user@123!invalid", "image/jpeg");
      // Should remove non-alphanumeric chars from userId
      expect(key).toMatch(/^user123invalid\/\d+-/);
    });

    it("should include timestamp and UUID", () => {
      const beforeTime = Date.now();
      const key = generateFileKey("user123", "image/jpeg");
      const afterTime = Date.now();

      const parts = key.split("/");
      expect(parts.length).toBe(2);

      const filename = parts[1].replace(".jpg", "");
      const [timestamp] = filename.split("-");

      expect(parseInt(timestamp, 10)).toBeGreaterThanOrEqual(beforeTime);
      expect(parseInt(timestamp, 10)).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("compressMetadata", () => {
    it("should compress metadata to compact JSON", () => {
      const metadata = {
        width: 1024,
        height: 768,
        durationMs: 5000,
        hash: "abc123",
      };

      const compressed = compressMetadata(metadata);
      const parsed = JSON.parse(compressed);

      expect(parsed).toEqual({
        w: 1024,
        h: 768,
        d: 5000,
        s: "abc123",
      });
    });

    it("should handle undefined metadata", () => {
      const compressed = compressMetadata(undefined);
      expect(compressed).toBe("{}");
    });

    it("should skip null and undefined values", () => {
      const metadata = {
        width: 1024,
        height: undefined,
        durationMs: null as any,
      };

      const compressed = compressMetadata(metadata);
      const parsed = JSON.parse(compressed);

      expect(parsed).toEqual({ w: 1024 });
    });
  });

  describe("decompressMetadata", () => {
    it("should decompress metadata correctly", () => {
      const compressed = JSON.stringify({ w: 1024, h: 768, d: 5000 });
      const decompressed = decompressMetadata(compressed);

      expect(decompressed).toEqual({
        width: 1024,
        height: 768,
        durationMs: 5000,
      });
    });

    it("should handle empty metadata", () => {
      const decompressed = decompressMetadata("{}");
      expect(decompressed).toEqual({});
    });

    it("should handle invalid JSON gracefully", () => {
      const decompressed = decompressMetadata("invalid json");
      expect(decompressed).toEqual({});
    });

    it("should round-trip compress/decompress", () => {
      const original = {
        width: 1920,
        height: 1080,
        durationMs: 10000,
        hash: "abc123def456",
      };

      const compressed = compressMetadata(original);
      const decompressed = decompressMetadata(compressed);

      expect(decompressed.width).toBe(original.width);
      expect(decompressed.height).toBe(original.height);
      expect(decompressed.durationMs).toBe(original.durationMs);
      expect(decompressed.hash).toBe(original.hash);
    });
  });

  describe("Metadata compression efficiency", () => {
    it("should reduce storage size for typical metadata", () => {
      const metadata = {
        width: 1024,
        height: 768,
        durationMs: 5000,
        hash: "abc123def456",
      };

      const full = JSON.stringify(metadata);
      const compressed = compressMetadata(metadata);

      expect(compressed.length).toBeLessThan(full.length);
    });

    it("should handle large width/height values", () => {
      const metadata = {
        width: 7680,
        height: 4320,
      };

      const compressed = compressMetadata(metadata);
      const decompressed = decompressMetadata(compressed);

      expect(decompressed.width).toBe(7680);
      expect(decompressed.height).toBe(4320);
    });
  });
});
