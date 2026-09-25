import { createCanvas } from "@napi-rs/canvas";

const DARK = 120;
const MIN_GRID_WIDTH = 0.72;

function dark(data, offset) {
  return data[offset] < DARK && data[offset + 1] < DARK && data[offset + 2] < DARK;
}

function groupPositions(positions) {
  const groups = [];
  for (const position of positions) {
    const last = groups.at(-1);
    if (last && position <= last.at(-1) + 2) last.push(position);
    else groups.push([position]);
  }
  return groups.map((group) => Math.round((group[0] + group.at(-1)) / 2));
}

function horizontalLines(data, width, height) {
  const positions = [];
  for (let y = 0; y < height; y += 1) {
    let pixels = 0;
    for (let x = 12; x < width - 12; x += 1) {
      if (dark(data, (y * width + x) * 4)) pixels += 1;
    }
    if (pixels >= (width - 24) * MIN_GRID_WIDTH) positions.push(y);
  }
  return groupPositions(positions);
}

function verticalLines(data, width, top, bottom) {
  const positions = [];
  const first = top + 3;
  const last = bottom - 3;
  if (last <= first) return positions;
  for (let x = 12; x < width - 12; x += 1) {
    let pixels = 0;
    for (let y = first; y < last; y += 1) {
      if (dark(data, (y * width + x) * 4)) pixels += 1;
    }
    if (pixels >= (last - first) * 0.75) positions.push(x);
  }
  return groupPositions(positions);
}

function tsvWords(tsv) {
  if (!tsv) return [];
  return tsv.split(/\r?\n/).slice(1).flatMap((line) => {
    const fields = line.split("\t");
    if (fields[0] !== "5" || fields.length < 12) return [];
    const value = fields.slice(11).join("\t").trim();
    if (!value || /^[|[\]{}~_]+$/.test(value)) return [];
    const [left, top, width, height, confidence] = fields.slice(6, 11).map(Number);
    if (![left, top, width, height, confidence].every(Number.isFinite)) return [];
    return [{ value, left, top, width, height, confidence,
      lineKey: fields.slice(1, 4).join(":") }];
  });
}

function rowCells(words, bounds, top, bottom) {
  const cells = Array.from({ length: bounds.length - 1 }, () => []);
  for (const word of words) {
    const cy = word.top + word.height / 2;
    if (cy <= top || cy >= bottom) continue;
    const cx = word.left + word.width / 2;
    const index = bounds.findIndex((edge, i) => i < bounds.length - 1 && cx >= edge && cx < bounds[i + 1]);
    if (index >= 0) cells[index].push(word);
  }
  return cells.map((wordsInCell) => wordsInCell.sort((a, b) => a.top - b.top || a.left - b.left)
    .map((word) => word.value).join(" ").trim());
}

export async function readAisGrid(page, worker, pageNumber, { requestedScale = 3 } = {}) {
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(requestedScale, Math.sqrt(16_000_000 / (natural.width * natural.height)));
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  const image = context.getImageData(0, 0, width, height);
  const lines = horizontalLines(image.data, width, height);
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const top = lines[index];
    const bottom = lines[index + 1];
    if (bottom - top < 16 || bottom - top > 110) continue;
    const bounds = verticalLines(image.data, width, top, bottom);
    if (bounds.length >= 5 && bounds[0] < width * 0.06 && bounds.at(-1) > width * 0.94) {
      rows.push({ pageNumber, rowNumber: rows.length + 1, top, bottom, bounds });
    }
  }
  const thresholded = image.data;
  for (let i = 0; i < thresholded.length; i += 4) {
    const value = dark(thresholded, i) ? 0 : 255;
    thresholded[i] = thresholded[i + 1] = thresholded[i + 2] = value;
  }
  for (const y of lines) {
    for (let x = 12; x < width - 12; x += 1) {
      const i = (y * width + x) * 4;
      thresholded[i] = thresholded[i + 1] = thresholded[i + 2] = 255;
    }
  }
  const ocrCanvas = createCanvas(width, height);
  ocrCanvas.getContext("2d").putImageData(image, 0, 0);
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const recognized = await worker.recognize(ocrCanvas.toBuffer("image/png"), {}, { tsv: true });
  const words = tsvWords(recognized.data.tsv);
  const lineWords = new Map();
  for (const word of words) {
    if (!lineWords.has(word.lineKey)) lineWords.set(word.lineKey, []);
    lineWords.get(word.lineKey).push(word);
  }
  const ocrLines = [...lineWords.values()].map((members) => ({
    text: members.sort((left, right) => left.left - right.left).map((word) => word.value).join(" "),
    left: Math.min(...members.map((word) => word.left)),
    top: Math.min(...members.map((word) => word.top)),
    right: Math.max(...members.map((word) => word.left + word.width)),
    bottom: Math.max(...members.map((word) => word.top + word.height)),
  })).sort((left, right) => left.top - right.top || left.left - right.left)
    .map((line, index) => ({ ...line, pageNumber, rowNumber: index + 1 }));
  async function refineCell(row, column, { numeric = false, threshold = 120 } = {}) {
    const left = row.bounds[column] + 2;
    const top = row.top + 2;
    const cropWidth = row.bounds[column + 1] - left - 2;
    const cropHeight = row.bottom - top - 2;
    if (cropWidth < 10 || cropHeight < 10) return { text: "", confidence: 0 };
    const crop = createCanvas(cropWidth * 3, cropHeight * 3);
    const cropContext = crop.getContext("2d");
    cropContext.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, crop.width, crop.height);
    const pixels = cropContext.getImageData(0, 0, crop.width, crop.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = pixels.data[i] < threshold ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    cropContext.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: "7",
      tessedit_char_whitelist: numeric ? "0123456789,." : "" });
    const reading = await worker.recognize(crop.toBuffer("image/png"));
    return { text: reading.data.text.trim(), confidence: Math.round(reading.data.confidence || 0) };
  }
  return { text: recognized.data.text || "", confidence: Math.round(recognized.data.confidence || 0),
    pageNumber, width, height, ocrLines, rows: rows.map((row) => ({ ...row,
      cells: rowCells(words, row.bounds, row.top, row.bottom),
    })), refineCell };
}
