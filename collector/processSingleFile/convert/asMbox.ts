import type { FileInput } from "../../types.js";
import { randomUUID as v4 } from "node:crypto";
import fs from "node:fs";
import { mboxParser } from "mbox-parser";
import {
  createdDate,
  trashFile,
  writeToServerDocuments,
} from "../../utils/files/index.js";
import { tokenizeString } from "../../utils/tokenizer/index.js";
import slugify from "slugify";

async function asMbox({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}: FileInput) {
  console.log(`-- Working ${filename} --`);

  const mails = await mboxParser(fs.createReadStream(fullFilePath))
    .then((mails) => mails)
    .catch((error) => {
      console.log(`Could not parse mail items`, error);
      return [];
    });

  if (!mails.length) {
    console.error(`Resulting mail items was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No mail items found in ${filename}.`,
      documents: [],
    };
  }

  let item = 1;
  const documents = [];
  for (const mail of mails) {
    if (!mail.hasOwnProperty("text")) continue;

    const content = mail.text;
    if (!content) continue;
    console.log(
      `-- Working on message "${mail.subject || "Unknown subject"}" --`
    );

    const data = {
      id: v4(),
      url: "file://" + fullFilePath,
      title:
        metadata.title ||
        (mail?.subject
          ? slugify(mail?.subject?.replace(".", "")) + ".mbox"
          : `msg_${item}-${filename}`),
      docAuthor: metadata.docAuthor || mail?.from?.text,
      description: metadata.description || "No description found.",
      docSource:
        metadata.docSource || "Mbox message file uploaded by the user.",
      chunkSource: metadata.chunkSource || "",
      published: createdDate(fullFilePath),
      wordCount: content.split(" ").length,
      pageContent: content,
      token_count_estimate: tokenizeString(content),
    };

    item++;
    const document = writeToServerDocuments({
      data,
      filename: `${slugify(filename)}-${data.id}-msg-${item}`,
      options: { parseOnly: options.parseOnly },
    });
    documents.push(document);
  }

  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(
    `[SUCCESS]: ${filename} messages converted & ready for embedding.\n`
  );
  return { success: true, reason: null, documents };
}

export default asMbox;
