// util.js — formatting helpers shared by components.

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(secs)) return '';
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [label, sec] of units) {
    const v = Math.floor(secs / sec);
    if (v >= 1) return `${v}${label} ago`;
  }
  return 'just now';
}

/** Strip tags and collapse whitespace into a plain-text snippet. */
export function snippet(html, max = 160) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const text = (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}
