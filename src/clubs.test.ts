import { describe, expect, it } from 'vitest';
import { clubGroup } from './clubs';
import { viewLabel } from './format';

describe('club groups', () => {
  it('puts woods and hybrids in the wood group and leaves unset clubs out', () => {
    expect(clubGroup('')).toBe('other');
    for (const club of ['3W', '5W', '3 wood', 'Hybrid', '4h', '4 hybrid']) {
      expect(clubGroup(club)).toBe('wood');
    }
  });

  it('maps drivers, irons, wedges, and putters', () => {
    expect(clubGroup('Putter')).toBe('putter');
    expect(clubGroup('putter')).toBe('putter');
    expect(clubGroup('Driver')).toBe('driver');
    expect(clubGroup('driver')).toBe('driver');
    expect(clubGroup('DR')).toBe('driver');

    for (const club of ['2i', '5i', '7I', '9i', '7 iron', '7-iron', 'long iron']) {
      expect(clubGroup(club)).toBe('iron');
    }

    for (const club of ['PW', 'GW', 'SW', 'LW', 'AW', '52', '56°', '60 degree', 'gap wedge', 'Pitching Wedge']) {
      expect(clubGroup(club)).toBe('wedge');
    }
  });
});

describe('view labels', () => {
  it('abbreviates the camera angle on chips and cards', () => {
    expect(viewLabel('dtl', true)).toBe('DTL');
    expect(viewLabel('face', true)).toBe('FO');
    expect(viewLabel('dtl')).toBe('Down the Line');
    expect(viewLabel('face')).toBe('Face On');
  });
});
