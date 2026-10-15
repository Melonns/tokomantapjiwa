// ponytail: kerja massal lewat Excel - ekspor katalog ke CSV, ubah harganya, impor balik ke draf panel admin.
export const CSV_HEADER = ['sku', 'nama', 'game', 'kategori', 'modal', 'harga_sekarang', 'harga_saran', 'mode', 'aktif'];

const cell = (value) => {
  const text = value == null ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function splitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; } else if (char === '"') quoted = false; else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(current); current = ''; } else current += char;
  }
  cells.push(current);
  return cells;
}

export function buildCatalogCsv(items) {
  const lines = [CSV_HEADER.join(';')];
  for (const item of items) {
    lines.push([item.sku, item.name, item.game, item.category, item.cost, item.price, item.saran, item.priceMode, item.enabled ? 'ya' : 'tidak'].map(cell).join(';'));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Balikin null kalau header tidak dikenal, supaya panel bisa bilang "pakai hasil Ekspor CSV sebagai contoh".
export function parseCatalogCsv(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const delimiter = (lines[0].match(/;/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length ? ';' : ',';
  const header = splitLine(lines[0], delimiter).map((name) => name.trim().toLowerCase());
  const skuAt = header.indexOf('sku');
  const priceAt = header.indexOf('harga_sekarang') >= 0 ? header.indexOf('harga_sekarang') : header.indexOf('harga');
  const modeAt = header.indexOf('mode');
  if (skuAt < 0 || priceAt < 0) return null;
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    const sku = (cells[skuAt] ?? '').trim();
    if (!sku) continue;
    const digits = String(cells[priceAt] ?? '').replace(/[^\d]/g, '');
    const price = digits ? Number(digits) : null;
    rows.push({
      sku,
      price: price != null && Number.isSafeInteger(price) && price >= 1 && price <= 100000000 ? price : null,
      priceMode: (cells[modeAt] ?? '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto',
    });
  }
  return rows;
}
