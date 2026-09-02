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

function evaluationBmp(width = 24, height = 24) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buffer = Buffer.alloc(54 + pixelBytes);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.writeInt32LE(3_780, 38);
  buffer.writeInt32LE(3_780, 42);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3;
      const accent = x === y || x === width - y - 1;
      buffer[offset] = accent ? 220 : 245;
      buffer[offset + 1] = accent ? 100 : 245;
      buffer[offset + 2] = accent ? 40 : 245;
    }
  }
  return buffer;
}

const EVALUATION_BMP = evaluationBmp();

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
  if (spec.image === true) {
    children.push(new Paragraph("Original embedded figure:"));
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: EVALUATION_BMP,
            transformation: { width: 24, height: 24 },
            type: "bmp",
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

module.exports = { evaluationBmp, fixtureBuffer, generatedDocx };
