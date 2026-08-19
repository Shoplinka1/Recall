import { randomUUID } from "node:crypto";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function privateObjectDir() {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return value.replace(/\/+$/, "");
}

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function privateObjectLocation() {
  return parseObjectPath(privateObjectDir());
}

async function signObjectUrl(input: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT";
}) {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: input.bucketName,
      object_name: input.objectName,
      method: input.method,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage signing failed (${response.status})`);
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("Object storage returned no signed URL");
  return body.signed_url;
}

export async function requestPrivateUpload(input: {
  ownerId: string;
  name: string;
  size: number;
  contentType: string;
}) {
  const { bucketName, objectName: privatePrefix } = privateObjectLocation();
  const objectName = `uploads/${input.ownerId}/${randomUUID()}`;
  return {
    uploadURL: await signObjectUrl({
      bucketName,
      objectName: `${privatePrefix}/${objectName}`,
      method: "PUT",
    }),
    objectPath: `/objects/${objectName}`,
    metadata: { name: input.name, size: input.size, contentType: input.contentType },
  };
}

export async function downloadPrivateObject(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private object path");
  const relativeObjectName = objectPath.slice("/objects/".length);
  if (!relativeObjectName || relativeObjectName.includes("..")) {
    throw new Error("Invalid private object path");
  }
  const { bucketName, objectName: privatePrefix } = privateObjectLocation();
  const url = await signObjectUrl({
    bucketName,
    objectName: `${privatePrefix}/${relativeObjectName}`,
    method: "GET",
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Private object download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}