import { describe, expect, it } from 'vitest';
import { looksLikeVideo, mimeAttempts, playbackMime } from './videoFile';

describe('video file types', () => {
  it('treats quicktime, empty types, and .mov names as video', () => {
    expect(looksLikeVideo({ type: 'video/quicktime', name: 'IMG_3803.mov' })).toBe(true);
    expect(looksLikeVideo({ type: '', name: 'IMG_3803.mov' })).toBe(true);
    expect(looksLikeVideo({ type: '', name: '' })).toBe(true);
    expect(looksLikeVideo({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
  });

  it('plays HEVC mov bytes as mp4, then quicktime', () => {
    expect(playbackMime('video/quicktime', 'IMG_3803.mov')).toBe('video/mp4');
    expect(playbackMime('', 'IMG_3803.mov')).toBe('video/mp4');
    expect(mimeAttempts('video/quicktime', 'IMG_3803.mov')).toEqual(['video/mp4', 'video/quicktime']);
    expect(playbackMime('video/webm', 'clip.webm')).toBe('video/webm');
  });
});
