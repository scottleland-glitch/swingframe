type WebKitVideo = HTMLVideoElement & {
  webkitExitFullscreen?: () => void;
};

/**
 * Attributes iOS needs in order to keep a video on the page.
 * Does not replace fullscreen methods or change pointer-events.
 */
export function markInline(video: HTMLVideoElement): void {
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.controls = false;
  video.removeAttribute('controls');
  video.preload = 'auto';
  video.autoplay = false;
}

/** Set the source only after markInline, then ask WebKit to load. */
export function loadInlineSource(video: HTMLVideoElement, url: string): void {
  markInline(video);
  video.src = url;
  video.load();
}

/** If iOS opened the system player, leave it. Never calls enter-fullscreen. */
export function exitIfNativeFullscreen(video: HTMLVideoElement): void {
  const node = video as WebKitVideo;
  try {
    node.webkitExitFullscreen?.();
  } catch {
    /* Not in the system player. */
  }
}

export function paintFirstFrame(video: HTMLVideoElement): void {
  if (video.currentTime >= 0.001) return;
  const duration = video.duration;
  const target = Number.isFinite(duration) && duration > 0 ? Math.min(0.001, duration) : 0.001;
  try {
    video.currentTime = target;
  } catch {
    /* The file is not seekable yet. The first decoded frame still shows after load. */
  }
}

export function mediaErrorMessage(video: HTMLVideoElement): string {
  const code = video.error?.code;
  if (code === 1) return 'Loading that video was interrupted.';
  if (code === 2) return 'The video file could not be read from this phone.';
  if (code === 3) return 'That video failed while decoding.';
  if (code === 4) return 'This phone could not decode that video.';
  return 'This phone could not show that video.';
}
