// Result tables for the benches and the tour: markdown for files, padded text for the terminal.

const cellText = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** A markdown table: `header` is the column titles, each row an array of cells. */
export function mdTable(header, rows) {
  return [header, header.map(() => '---'), ...rows].map(r => `| ${r.map(cellText).join(' | ')} |`).join('\n')
}

/** A box-drawn text table over `cols` of each row object, each column at most `max` characters. */
export function textTable(cols, rows, max = 60) {
  const widths = cols.map(c => Math.min(max, Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))))
  const cell = (v, w) => String(v ?? '').slice(0, w).padEnd(w)
  return [
    cols.map((c, i) => cell(c, widths[i])).join(' │ '),
    widths.map(w => '─'.repeat(w)).join('─┼─'),
    ...rows.map(r => cols.map((c, i) => cell(r[c], widths[i])).join(' │ '))
  ].join('\n')
}
