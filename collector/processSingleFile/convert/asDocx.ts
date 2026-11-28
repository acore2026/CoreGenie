import type { FileInput } from "../../types.js";
import { randomUUID as v4 } from "node:crypto";
import mammoth from "mammoth";
import {
  createdDate,
  trashFile,
  writeToServerDocuments,
} from "../../utils/files/index.js";
import { tokenizeString } from "../../utils/tokenizer/index.js";
import slugify from "slugify";

async function asDocX({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}: FileInput) {
  console.log(`-- Working ${filename} --`);
  const extracted = await mammoth.extractRawText({ path: fullFilePath });
  const content = (extracted?.value || "").trim();

  if (!content.length) {
    console.error(`Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "no author found",
    description: metadata.description || "No description found.",
    docSource: metadata.docSource || "docx file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

export default asDocX;
