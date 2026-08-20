import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractMaterialText } from "../artifacts/api-server/src/lib/material-processing.ts";

const baseUrl = process.env.MATERIAL_TEST_BASE_URL ?? "http://127.0.0.1:8080";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

class Client {
  cookie = "";

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const body = response.status === 204 ? null : await response.json();
    return { response, body };
  }

  json(path, method, value) {
    return this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  }
}

async function waitForMaterial(client, id) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.request(`/api/materials/${id}`);
    if (result.body.processingStatus !== "PROCESSING") return result.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for material ${id}`);
}

async function buildDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><body><p><r><t>DOCX pipeline text</t></r></p></body></document>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildPptx() {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>PPTX pipeline text</a:t></p:cSld></p:sld>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function buildPdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (PDF pipeline text) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

const plainText =
  "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs photons during photosynthesis. Carbon fixation produces glucose molecules through cellular pathways.";
const pdfBuffer = buildPdf();
const docxBuffer = await buildDocx();
const pptxBuffer = await buildPptx();

assert.match(await extractMaterialText(Buffer.from(plainText), "text/plain", "notes.txt"), /Photosynthesis/);
assert.match(await extractMaterialText(pdfBuffer, "application/pdf", "notes.pdf"), /PDF pipeline/);
assert.match(await extractMaterialText(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "notes.docx"), /DOCX pipeline/);
assert.match(await extractMaterialText(pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "notes.pptx"), /PPTX pipeline/);

const userA = new Client();
let result = await userA.json("/api/auth/signup", "POST", {
  name: "Material Test A",
  email: `material-a-${suffix}@example.test`,
  password: "correct horse battery staple",
});
assert.equal(result.response.status, 201);
result = await userA.json("/api/subjects", "POST", {
  name: "Material Pipeline Subject",
  description: "Executable Step 3 test",
  color: "#3d8f76",
});
assert.equal(result.response.status, 201);
const subjectId = result.body.id;

result = await userA.json("/api/materials", "POST", {
  title: "Pasted pipeline",
  subjectId,
  fileType: "text/plain",
  pastedText: plainText,
});
assert.equal(result.response.status, 201);
const pastedId = result.body.id;
assert.equal(result.body.processingStatus, "PROCESSING");
let material = await waitForMaterial(userA, pastedId);
assert.equal(material.processingStatus, "READY");
result = await userA.request(`/api/materials/${pastedId}/sections`);
assert.equal(result.response.status, 200);
assert.ok(result.body.length > 0);
assert.match(result.body[0].content, /Photosynthesis/);
result = await userA.request("/api/concepts");
assert.ok(result.body.some((concept) => concept.name === "Photosynthesis"));

result = await userA.json("/api/storage/uploads/request-url", "POST", {
  name: "uploaded.txt",
  size: Buffer.byteLength(plainText),
  contentType: "text/plain",
});
assert.equal(result.response.status, 200);
assert.match(result.body.objectPath, /^\/objects\/uploads\//);
const upload = result.body;
const uploadResponse = await fetch(upload.uploadURL, {
  method: "PUT",
  headers: { "content-type": "text/plain" },
  body: plainText,
});
assert.equal(uploadResponse.status, 200);

result = await userA.json("/api/materials", "POST", {
  title: "Uploaded pipeline",
  subjectId,
  fileType: "text/plain",
  originalFileName: "uploaded.txt",
  fileSize: Buffer.byteLength(plainText),
  storagePath: upload.objectPath,
});
assert.equal(result.response.status, 201);
const uploadedId = result.body.id;
material = await waitForMaterial(userA, uploadedId);
assert.equal(material.processingStatus, "READY");
assert.match(material.excerpt, /Photosynthesis/);

const currentUser = await userA.request("/api/auth/me");
result = await userA.json("/api/materials", "POST", {
  title: "Broken upload",
  subjectId,
  fileType: "text/plain",
  storagePath: `/objects/uploads/${currentUser.body.user.id}/missing-object`,
});
assert.equal(result.response.status, 201);
const failedId = result.body.id;
material = await waitForMaterial(userA, failedId);
assert.equal(material.processingStatus, "FAILED");
assert.ok(material.processingError);
result = await userA.request(`/api/materials/${failedId}/retry`, { method: "POST" });
assert.equal(result.response.status, 422);
assert.equal(result.body.processingStatus, "FAILED");

const userB = new Client();
result = await userB.json("/api/auth/signup", "POST", {
  name: "Material Test B",
  email: `material-b-${suffix}@example.test`,
  password: "correct horse battery staple",
});
assert.equal(result.response.status, 201);
assert.equal((await userB.request(`/api/materials/${pastedId}`)).response.status, 404);
assert.equal((await userB.request(`/api/materials/${pastedId}/sections`)).response.status, 404);
const conceptsB = await userB.request("/api/concepts");
assert.equal(conceptsB.body.some((concept) => concept.name === "Photosynthesis"), false);
result = await userB.json("/api/subjects", "POST", {
  name: "Material Test B Subject",
  description: "Owned by User B",
  color: "#3d8f76",
});
assert.equal(result.response.status, 201);
const subjectB = (await userB.request("/api/subjects")).body[0];
result = await userB.json("/api/materials", "POST", {
  title: "Wrong owner path",
  subjectId: subjectB.id,
  fileType: "text/plain",
  storagePath: upload.objectPath,
});
assert.equal(result.response.status, 403);

console.log("Material pipeline tests passed.", { pastedId, uploadedId, failedId });