const fs = require("fs/promises");
const path = require("path");
const {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} = require("docx");

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function generatedDocx(spec = {}) {
  const title = String(spec.title || spec.name || "Evaluation TDoc");
  const paragraphs = Array.isArray(spec.paragraphs)
    ? spec.paragraphs
    : [String(spec.text || "Evaluation content")];
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    ...paragraphs.map(
      (text) => new Paragraph({ children: [new TextRun(String(text))] })
    ),
  ];
  if (Array.isArray(spec.table) && spec.table.length) {
    children.push(
      new Table({
        rows: spec.table.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph(String(cell))],
                  })
              ),
            })
        ),
      })
    );
  }
  if (spec.image !== false) {
    children.push(new Paragraph("Original embedded figure:"));
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: PIXEL_PNG,
            transformation: { width: 24, height: 24 },
            type: "png",
          }),
        ],
      })
    );
  }
  return Packer.toBuffer(
    new Document({ sections: [{ properties: {}, children }] })
  );
}

async function fixtureBuffer(spec = {}, root = "/opt/anythingllm-evals") {
  if (spec.generate === "docx") return generatedDocx(spec);
  if (spec.content !== undefined) return Buffer.from(String(spec.content));
  if (!spec.path)
    throw new Error("Fixture requires path, content, or generate.");
  const candidate = path.resolve(root, "fixtures", String(spec.path));
  const fixtureRoot = path.resolve(root, "fixtures");
  if (
    candidate !== fixtureRoot &&
    !candidate.startsWith(`${fixtureRoot}${path.sep}`)
  )
    throw new Error("Fixture path escapes the fixture directory.");
  return fs.readFile(candidate);
}

module.exports = { fixtureBuffer, generatedDocx };
