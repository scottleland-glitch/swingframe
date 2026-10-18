# Swingframe

A mobile-first golf swing notebook for Scott. Record a swing or pull one in from the camera roll, tag it **Down the Line** or **Face On**, then scrub it frame by frame and draw on it. Videos and drawings stay in the browser on that phone. There is no account and nothing is uploaded.

It is a static web app, built to be added to an iPhone Home Screen and used one-handed on the range.

## What's in this version

- **Capture.** Record with the phone camera, or choose an existing video (including slo-mo from the Camera app). Each swing is tagged Down the Line or Face On, with an optional date, club, and notes.
- **Library.** A list on this phone, filtered by All, Down the Line, or Face On. Stored in IndexedDB, including the video file.
- **Playback.** Play and pause, a scrub bar, step forward or back one frame, and speeds of 1×, ½, ¼, and 0.1×. The frame step size is 30, 60, 120, or 240 fps, saved with the swing. Playback is inline and starts muted so iPhone Safari will actually play it. Sound and loop are toggles.
- **Drawing.** Straight lines (the segment you drag is extended across the frame, for a shaft or swing plane), freehand, a three-tap angle tool that shows degrees, circles, boxes, and horizontal or vertical reference lines. Colors, move, reshape, delete, undo, and clear. Pinch to zoom, or use the + / − buttons. Drawings are stored in the video's own coordinate space, so they stay aligned when you zoom or rotate the phone, and they come back when you reopen the swing.
- **Compare.** Pick two swings. In portrait they stack; turn the phone sideways (or use a wide window) and they sit side by side. Each clip scrubs on its own. Sync matches progress through the swing, so the second clip follows the one you play or scrub. Synced playback plays one video and seeks the other, which is the reliable way to do this on an iPhone.
- **Installable.** Web app manifest, home screen icons, standalone display, and a service worker so the app shell loads offline after the first visit. Saved videos are already on the device and do not need the network.

## What's next

- Read the real frame rate out of the file, instead of a 30/60/120/240 step setting.
- Sync two angles on an impact frame you tap, not only by percent through the clip.
- Export a still with the drawings burned in.
- Back up or export the library, so a phone reset is not the end of the notes.
- Trim a clip down to the swing.

## Run it on your computer

You need Node.js 20 or newer. From this folder:

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173. `npm test` checks the angle math and the drawing hit tests. `npm run build` makes the static site in `dist/`.

## Put it on Scott's iPhone

The home screen app needs **HTTPS**. A laptop on the same Wi-Fi (`npm run dev -- --host`) is fine for a quick look, but iOS will not install a service worker or treat the site as an app over plain `http`. Use Safari on the iPhone, not Chrome. Chrome on iOS cannot add a proper Home Screen app.

Import swings **after** opening the icon you added. On iPhone, the Home Screen app keeps its own storage, separate from a Safari tab. Swings saved in the tab will not show up inside the icon.

### Easiest: Netlify Drop

1. On the computer: `npm install` then `npm run build`.
2. Sign in at [https://app.netlify.com/drop](https://app.netlify.com/drop) (a free account is enough).
3. Drag the `dist` folder onto the page. Netlify gives you an `https://` address.
4. On the iPhone, open that address in **Safari**.
5. Tap the Share button (the square with the arrow), then **Add to Home Screen**. Name it Swingframe and tap Add.
6. Open Swingframe from the home screen. The first time you record or choose a video, allow Camera or Photos if iOS asks.

### When you want updates later: Cloudflare Pages

1. Push this repo to GitHub.
2. In [Cloudflare Pages](https://pages.cloudflare.com), create a project from that repo.
3. Build command: `npm run build`. Output directory: `dist`.
4. Open the `https://` URL Cloudflare gives you, and add it to the Home Screen the same way.

After it has loaded once from the icon, the screens open offline. Videos you already saved play offline too. The first install still needs a network connection.

## Using it on the range

1. For a true slow-motion swing, record **Slo-Mo** in the iPhone Camera app (120 or 240), then in Swingframe choose **Choose from library**. The Record button opens the camera, which is the right path for a normal clip.
2. Tag Down the Line or Face On before saving.
3. Open the swing. Set **Step** to 120 or 240 if one tap jumps several frames, or lower it if a tap barely moves.
4. Drag a line from the ball through the hands, or tap three points for spine angle or knee flex.
5. Pinch, or tap +, to zoom in. The ink stays on the frame.
6. To compare a Down the Line and a Face On of the same swing, save both, tap Compare, and turn Sync on. Scrub either clip to the same point in the motion.

Sound is off until you tap the speaker. Hearing impact is useful; the speaker is next to the loop button.

## Good to know

- A slo-mo clip can be tens of megabytes. If the phone is full, saving fails with a clear message instead of a half-saved swing.
- iOS can still delete website data if the app is never opened. Swingframe asks for persistent storage. Add it to the Home Screen and open it now and then. Deleting the Home Screen icon can delete the saved swings.
- iPhone videos are often HEVC. Safari plays them. Some desktop browsers will not, and will show a message on the player. Review those clips on the phone.
- Frame stepping is only as precise as the browser's seek. The fps control sets the step size; it does not re-encode the video.
- There is no analytics and no backend. After the app files load, video never leaves the phone.
