export async function descrambleImageBlob(
  blob: Blob,
  num: number,
): Promise<Blob> {
  if (num <= 1) return blob;

  const bmp = await createImageBitmap(blob);
  const width = bmp.width;
  const height = bmp.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");

  const rem = height % num;
  const copyHeight = Math.floor(height / num);

  const blocks: Array<{ start: number; end: number }> = [];
  let totalH = 0;
  for (let i = 0; i < num; i++) {
    let h = copyHeight * (i + 1);
    if (i === num - 1) h += rem;
    blocks.push({ start: totalH, end: h });
    totalH = h;
  }

  let y = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { start, end } = blocks[i];
    const h = end - start;
    ctx.drawImage(bmp, 0, start, width, h, 0, y, width, h);
    y += h;
  }

  bmp.close();

  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error("toBlob failed"));
      else resolve(b);
    }, blob.type || "image/jpeg");
  });
  return out;
}
