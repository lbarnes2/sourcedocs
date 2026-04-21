import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

let client: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

function requireBucket(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error("R2_BUCKET_NAME is not set.");
  return name;
}

export function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured (missing env vars).");
  }
  if (!client) {
    const accountId = process.env.R2_ACCOUNT_ID!;
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
      }
    });
  }
  return client;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function r2GetObjectBytes(
  key: string
): Promise<{ body: Buffer; contentType: string | undefined } | null> {
  const c = getR2Client();
  const bucket = requireBucket();
  try {
    const out = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await streamToBuffer(out.Body);
    return { body, contentType: out.ContentType };
  } catch (error: unknown) {
    const name = error && typeof error === "object" && "name" in error ? (error as { name: string }).name : "";
    if (name === "NoSuchKey") return null;
    throw error;
  }
}

export async function r2PutObjectBytes(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const c = getR2Client();
  const bucket = requireBucket();
  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

export async function r2PutObjectUtf8(key: string, body: string): Promise<void> {
  await r2PutObjectBytes(key, Buffer.from(body, "utf8"), "application/json; charset=utf-8");
}

export async function r2GetObjectUtf8(key: string): Promise<string | null> {
  const got = await r2GetObjectBytes(key);
  if (!got) return null;
  return got.body.toString("utf8");
}

export async function r2DeleteObject(key: string): Promise<void> {
  const c = getR2Client();
  const bucket = requireBucket();
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** S3 CopySource: bucket + URL-encoded key (slashes preserved between segments). */
function r2CopySource(bucket: string, sourceKey: string): string {
  const encodedKey = sourceKey.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encodedKey}`;
}

export async function r2CopyObject(sourceKey: string, destKey: string): Promise<void> {
  const c = getR2Client();
  const bucket = requireBucket();
  await c.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: r2CopySource(bucket, sourceKey),
      Key: destKey
    })
  );
}

export async function r2ObjectExists(key: string): Promise<boolean> {
  const c = getR2Client();
  const bucket = requireBucket();
  try {
    await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "$metadata" in error) {
      const code = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return false;
    }
    const name = error && typeof error === "object" && "name" in error ? (error as { name: string }).name : "";
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw error;
  }
}

export async function r2ListObjectKeys(prefix: string): Promise<string[]> {
  const c = getR2Client();
  const bucket = requireBucket();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const out = await c.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    for (const obj of out.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}
