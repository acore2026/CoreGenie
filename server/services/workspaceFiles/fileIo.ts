const fs = require("fs/promises");
const path = require("path");
const { randomBytes } = require("crypto");
const { createTwoFilesPatch } = require("diff");
const { normalizeLineEndings } = require("./pathSecurity.ts");

const FILE_READ_CHUNK_SIZE = 1024;
const CONTEXT_RESERVE_RATIO = 0.25;
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
];
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

export interface FileEdit {
  oldText: string;
  newText: string;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

function createUnifiedDiff(
  originalContent: string,
  newContent: string,
  filepath = "file"
): string {
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    "original",
    "modified"
  );
}

async function parseFileWithCollector(
  filePath: string
): Promise<{ content: string | null; parsed: boolean; error?: string }> {
  try {
    const { CollectorApi } = require("../../utils/collectorApi");
    const collectorApi = new CollectorApi();

    const isOnline = await collectorApi.online();
    if (!isOnline) {
      return {
        content: null,
        parsed: false,
        error: "Collector service offline",
      };
    }

    const filename = path.basename(filePath);
    const result = await collectorApi.parseDocument(filename, {
      absolutePath: filePath,
    });

    if (!result || !result.success) {
      return {
        content: null,
        parsed: false,
        error: result?.reason || "Failed to parse document",
      };
    }

    if (result.content) return { content: result.content, parsed: true };
    if (result.documents && result.documents.length > 0) {
      const content = result.documents
        .map(
          (doc: { pageContent?: string; content?: string }) =>
            doc.pageContent || doc.content || ""
        )
        .filter(Boolean)
        .join("\n\n");
      if (content) return { content, parsed: true };
    }

    return { content: null, parsed: false, error: "No content in response" };
  } catch (error: unknown) {
    return {
      content: null,
      parsed: false,
      error: (error as Error).message,
    };
  }
}

async function tailFileRaw(
  filePath: string,
  numLines: number
): Promise<string> {
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;

  if (fileSize === 0) return "";

  const fileHandle = await fs.open(filePath, "r");
  try {
    const lines: string[] = [];
    let position = fileSize;
    const chunk = Buffer.alloc(FILE_READ_CHUNK_SIZE);
    let linesFound = 0;
    let remainingText = "";

    while (position > 0 && linesFound < numLines) {
      const size = Math.min(FILE_READ_CHUNK_SIZE, position);
      position -= size;

      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;

      const readData = chunk.slice(0, bytesRead).toString("utf-8");
      const chunkText = readData + remainingText;

      const chunkLines = normalizeLineEndings(chunkText).split("\n");

      if (position > 0) {
        remainingText = chunkLines[0];
        chunkLines.shift();
      }

      for (
        let i = chunkLines.length - 1;
        i >= 0 && linesFound < numLines;
        i--
      ) {
        lines.unshift(chunkLines[i]);
        linesFound++;
      }
    }

    return lines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

async function headFileRaw(
  filePath: string,
  numLines: number
): Promise<string> {
  const fileHandle = await fs.open(filePath, "r");
  try {
    const lines: string[] = [];
    let buffer = "";
    let bytesRead = 0;
    const chunk = Buffer.alloc(FILE_READ_CHUNK_SIZE);

    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
      buffer += chunk.slice(0, result.bytesRead).toString("utf-8");

      const newLineIndex = buffer.lastIndexOf("\n");
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split("\n");
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }

    if (buffer.length > 0 && lines.length < numLines) {
      lines.push(buffer);
    }

    return lines.join("\n");
  } finally {
    await fileHandle.close();
  }
}

function applyTextEdits(originalContent: string, edits: FileEdit[]): string {
  let modifiedContent = originalContent;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    const oldLines = normalizedOld.split("\n");
    const contentLines = modifiedContent.split("\n");
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);

      const isMatch = oldLines.every((oldLine: string, j: number) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || "";
        const newLines = normalizedNew
          .split("\n")
          .map((line: string, j: number) => {
            if (j === 0) return originalIndent + line.trimStart();
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || "";
            const newIndent = line.match(/^\s*/)?.[0] || "";
            if (oldIndent && newIndent) {
              const relativeIndent = newIndent.length - oldIndent.length;
              return (
                originalIndent +
                " ".repeat(Math.max(0, relativeIndent)) +
                line.trimStart()
              );
            }
            return line;
          });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join("\n");
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }
  return modifiedContent;
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_TYPES[ext] || null;
}

async function readImageAsAttachment(
  filePath: string
): Promise<{ name: string; mime: string; contentString: string } | null> {
  try {
    const mime = getImageMimeType(filePath);
    if (!mime) return null;

    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString("base64");
    const filename = path.basename(filePath);

    return {
      name: filename,
      mime,
      contentString: `data:${mime};base64,${base64}`,
    };
  } catch (error: unknown) {
    console.error(
      `Error reading image file ${filePath}:`,
      (error as Error).message
    );
    return null;
  }
}

module.exports = {
  FILE_READ_CHUNK_SIZE,
  CONTEXT_RESERVE_RATIO,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  atomicWrite,
  createUnifiedDiff,
  parseFileWithCollector,
  tailFileRaw,
  headFileRaw,
  applyTextEdits,
  isImageFile,
  getImageMimeType,
  readImageAsAttachment,
};
