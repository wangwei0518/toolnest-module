import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListPartsCommand, PutObjectCommand,
  S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function disposition(filename: string) {
  const safeName = filename.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "download";
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

/** Only the server holds the R2 credentials; file bytes go directly to R2. */
export class R2Storage {
  private readonly client: S3Client;
  constructor(private readonly config: R2Config) {
    if (!/^[a-f0-9]{32}$/.test(config.accountId)) throw new Error("R2 账号 ID 无效");
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async start(key: string, filename: string) {
    const response = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket, Key: key, ContentType: "application/octet-stream",
      ContentDisposition: disposition(filename), CacheControl: "private, no-store",
    }));
    if (!response.UploadId) throw new Error("R2 未返回上传会话");
    return response.UploadId;
  }

  putEmpty(key: string, filename: string) {
    return this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentLength: 0, Body: Buffer.alloc(0),
      ContentType: "application/octet-stream", ContentDisposition: disposition(filename), CacheControl: "private, no-store" }));
  }

  signPart(key: string, uploadId: string, partNumber: number, size: number) {
    return getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: size }), { expiresIn: 300 });
  }

  async parts(key: string, uploadId: string) {
    const parts: Array<{ PartNumber: number; ETag: string; Size: number }> = [];
    let marker: string | undefined;
    do {
      const response = await this.client.send(new ListPartsCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      for (const part of response.Parts ?? []) {
        if (part.PartNumber === undefined || !part.ETag || part.Size === undefined) throw new Error("R2 返回的分片信息不完整");
        parts.push({ PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size });
      }
      marker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
      if (response.IsTruncated && !marker) throw new Error("R2 分片列表不完整");
    } while (marker);
    return parts;
  }

  async complete(key: string, uploadId: string, expectedSize: number, partSize: number) {
    const parts = await this.parts(key, uploadId);
    const expectedCount = Math.ceil(expectedSize / partSize);
    if (parts.length !== expectedCount || parts.some((part, index) =>
      part.PartNumber !== index + 1 || part.Size !== (index === expectedCount - 1 ? expectedSize - index * partSize : partSize))) {
      throw new Error("上传分片不完整或大小不匹配");
    }
    await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) } }));
    const object = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (object.ContentLength !== expectedSize) throw new Error("上传完成后的文件大小不匹配");
  }

  async hasCompletedObject(key: string, expectedSize: number) {
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return object.ContentLength === expectedSize;
    } catch (error) {
      if (error && typeof error === "object" && "$metadata" in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  abort(key: string, uploadId: string) {
    return this.client.send(new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId }));
  }

  remove(key: string) { return this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })); }

  download(key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: 120 });
  }
}
