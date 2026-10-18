type WebKitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/**
 * iOS Safari, including a Home Screen web app, sends a video into the system
 * player unless playsinline and webkit-playsinline are real attributes before
 * src is assigned. Call this, then set src.
 */
export function lockInlinePlayback(video: HTMLVideoElement): void {
  const node = video as WebKitVideo;
  node.playsInline = true;
  node.setAttribute('playsinline', 'true');
  node.setAttribute('webkit-playsinline', 'true');
  node.controls = false;
  node.removeAttribute('controls');
  node.autoplay = false;
  node.disablePictureInPicture = true;
  node.setAttribute('disableremoteplayback', 'true');
  node.setAttribute('x-webkit-airplay', 'deny');
  node.setAttribute('x5-playsinline', 'true');
  node.setAttribute('x5-video-player-type', 'h5');
  node.setAttribute('x5-video-player-fullscreen', 'false');
  node.style.pointerEvents = 'none';

  const refuseFullscreen = () => undefined;
  try {
    node.webkitEnterFullscreen = refuseFullscreen;
  } catch {
    /* Home Screen WebKit may not allow replacing the native method. */
  }
  try {
    node.requestFullscreen = () => Promise.reject(new DOMException('Playback stays inline.', 'NotAllowedError'));
  } catch {
    /* Same as above. playsinline still keeps playback on the page. */
  }
  node.dataset.inlineLocked = '1';
}

export function exitNativeFullscreen(video: HTMLVideoElement): void {
  const node = video as WebKitVideo;
  if (!node.webkitDisplayingFullscreen) return;
  try {
    node.webkitExitFullscreen?.();
  } catch {
    /* Already back on the page. */
  }
}
