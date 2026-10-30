export type ClubFilter = 'all' | 'driver' | 'wood' | 'iron' | 'wedge' | 'putter';

/** Driver, wood (fairway woods and hybrids), iron, wedge, and putter. */
export function clubGroup(club: string): Exclude<ClubFilter, 'all'> | 'other' {
  const text = club.trim().toLowerCase().replace(/[°º]/g, ' ');
  if (!text) return 'other';
  if (/\bputt(er|ing)?\b/.test(text)) return 'putter';
  if (text.includes('wedge') || /\b(pw|gw|sw|lw|aw)\b/.test(text)) return 'wedge';
  if (/\bdriver\b/.test(text) || text === 'dr') return 'driver';
  if (/\b(?:wood|hybrid|rescue|fairway)\b/.test(text) || /^[2-9]\s*(?:w|h)$/.test(text)) return 'wood';
  const compact = text.replace(/[^a-z0-9]/g, '');
  if (compact.endsWith('iron') || compact.endsWith('i') || /\b[2-9]\s*i\b/.test(text)) return 'iron';
  if (/\b(?:4[6-9]|5\d|6[0-4])\b/.test(text)) return 'wedge';
  return 'other';
}
