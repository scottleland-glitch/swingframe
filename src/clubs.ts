export type ClubFilter = 'all' | 'driver' | 'iron' | 'wedge';

/** Driver, iron, and wedge. Woods, hybrids, and the putter stay in All only. */
export function clubGroup(club: string): Exclude<ClubFilter, 'all'> | 'other' {
  const text = club.trim().toLowerCase().replace(/[°º]/g, ' ');
  if (!text) return 'other';
  if (text.includes('wedge') || /\b(pw|gw|sw|lw|aw)\b/.test(text)) return 'wedge';
  if (/\bdriver\b/.test(text) || text === 'dr') return 'driver';
  const compact = text.replace(/[^a-z0-9]/g, '');
  if (compact.endsWith('iron') || compact.endsWith('i') || /\b[2-9]\s*i\b/.test(text)) return 'iron';
  if (/\b(?:4[6-9]|5\d|6[0-4])\b/.test(text)) return 'wedge';
  return 'other';
}
