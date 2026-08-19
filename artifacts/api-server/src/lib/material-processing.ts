import JSZip from "jszip";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const MAX_TEXT_LENGTH = 2_000_000;

function cleanText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function extractPptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("text");
    const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((match) =>
        match[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"'),
      )
      .join(" ");
    if (text.trim()) slides.push(`Slide ${slides.length + 1}\n${text}`);
  }
  return slides.join("\n\n");
}

export async function extractMaterialText(
  buffer: Buffer,
  fileType: string,
  fileName: string,
) {
  const extension = fileName.toLowerCase().split(".").pop() ?? fileType.toLowerCase();
  if (extension === "txt" || fileType === "text/plain" || fileType === "notes") {
    return cleanText(buffer.toString("utf8"));
  }
  if (extension === "pdf" || fileType === "application/pdf") {
    const result = await pdfParse(buffer);
    return cleanText(result.text);
  }
  if (extension === "docx" || fileType.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(result.value);
  }
  if (extension === "pptx" || fileType.includes("presentationml")) {
    return cleanText(await extractPptx(buffer));
  }
  throw new Error("Unsupported file type. Use TXT, PDF, DOCX, or PPTX.");
}

export function splitMaterialText(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (current && current.length + paragraph.length + 2 > 1200) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

export function extractConceptNames(text: string) {
  const words = text
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 5 && word.length <= 32);
  const stopWords = new Set([
    "about", "after", "before", "between", "could", "these", "their", "there",
    "which", "where", "while", "using", "through", "because", "should",
  ]);
  const counts = new Map<string, number>();
  for (const word of words) {
    const normalized = word.toLowerCase();
    if (stopWords.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name]) => name.replace(/^\w/, (letter) => letter.toUpperCase()));
}