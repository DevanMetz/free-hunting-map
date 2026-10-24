/** RFC 4180 fields, including BOM, escaped quotes, CRLF and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      row.push(field); if (row.some((v) => v.trim())) rows.push(row);
      row = []; field = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else field += c;
  }
  if (quoted) throw new Error('Unclosed CSV field');
  row.push(field); if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
