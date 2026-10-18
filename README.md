# Swingframe

A mobile-first golf swing notebook for Scott. Record a swing or pull one in from the camera roll, tag it **Down the Line** or **Face On**, then scrub it frame by frame and draw on it. Videos and drawings stay in the browser on that phone. There is no account and nothing is uploaded.

It is a static web app, built to be added to an iPhone Home Screen and used one-handed on the range.

## What's in this version

- **Capture.** Record with the phone camera, or choose an existing video (including slo-mo from the Camera app). Each swing is tagged Down the Line or Face On, with an optional date, club, and notes.
- **Library.** A list on this phone, filtered by All, Down the Line, or Face On. Stored in IndexedDB, including the video file.
- **Playback.** The video stays inside the page. It does not open the iPhone's full-screen player, so the drawing tools stay on screen. A white bar at the bottom has the speed, frame step, play, and a wrench. Drag the time at the top right, or the thin bar, to scrub. Speeds are 1×, ½, ¼, and 0.1×. The frame step size is 30, 60, 120, or 240 fps, saved with the swing. Sound, loop, details, and delete are under the ? button.
- **Drawing.** Open the wrench. Straight lines (the segment you drag is extended across the frame, for a shaft or swing plane), freehand, a three-tap angle tool that shows degrees, circles, boxes, horizontal or vertical reference lines, and erase. Colors, move, reshape, undo, and clear. Flip mirrors the picture. Pinch zooms, and the ink stays on the video. Trim sets a start and end. Overlay lays another swing on top, half transparent. Drawings are stored in the video's own coordinate space, so they stay aligned when you zoom, flip, or rotate the phone, and they come back when you reopen the swing.
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

Open the URL Vite prints, then add `/swingframe/` (usually http://localhost:5173/swingframe/). The app is built for that subpath so it matches GitHub Pages. `npm test` checks the angle math and the drawing hit tests. `npm run build` makes the static site in `dist/`.

## Put it on Scott's iPhone

The home screen app needs **HTTPS**. A laptop on the same Wi-Fi (`npm run dev -- --host`) is fine for a quick look, but iOS will not install a service worker or treat the site as an app over plain `http`. Use Safari on the iPhone, not Chrome. Chrome on iOS cannot add a proper Home Screen app.

Import swings **after** opening the icon you added. On iPhone, the Home Screen app keeps its own storage, separate from a Safari tab. Swings saved in the tab will not show up inside the icon.

### GitHub Pages

The address is [https://scottleland-glitch.github.io/swingframe/](https://scottleland-glitch.github.io/swingframe/), from a public repo named `swingframe` under `scottleland-glitch`. That repo is separate from `golf-shot-tracker`. A push to `main` runs `.github/workflows/pages.yml`, which builds `dist/` and deploys with GitHub Actions. Assets, the manifest, and the service worker all live under `/swingframe/`, and the cache name is prefixed `swingframe` so it does not share caches with another site on `github.io`.

One-time setup, signed in as scottleland-glitch:

1. Create a new **public** repository named `swingframe`. Leave `golf-shot-tracker` alone.
2. Push this project to that repo's `main` branch.
3. In the repo, open Settings → Pages → Build and deployment, and set Source to **GitHub Actions**.
4. Wait until the "Deploy GitHub Pages" workflow is green.

Then on the iPhone:

1. Open [https://scottleland-glitch.github.io/swingframe/](https://scottleland-glitch.github.io/swingframe/) in **Safari**.
2. Tap the Share button (the square with the arrow), then **Add to Home Screen**. Name it Swingframe and tap Add.
3. Open Swingframe from the home screen. The first time you record or choose a video, allow Camera or Photos if iOS asks.

Do not host this build at the root of another domain without changing `base` in `vite.config.ts`. A root host would look for files at `/swingframe/` and miss them.

After it has loaded once from the icon, the screens open offline. Videos you already saved play offline too. The first install still needs a network connection.

## Using it on the range

1. For a true slow-motion swing, record **Slo-Mo** in the iPhone Camera app (120 or 240), then in Swingframe choose **Choose from library**. The Record button opens the camera, which is the right path for a normal clip.
2. Tag Down the Line or Face On before saving.
3. Open the swing. The picture stays in the page. Tap **?** and set **Step** to 120 or 240 if one tap jumps several frames, or lower it if a tap barely moves.
4. Tap the wrench, choose Line, and drag from the ball through the hands. Angle is three taps. The ink stays put if you flip or pinch-zoom.
5. Drag the time at the top, or the thin bar, to scrub. The speed pill cycles 1x, 0.5x, 0.25x, and 0.1x.
6. To compare a Down the Line and a Face On of the same swing, save both, open the wrench, tap Compare, and turn Sync on. Overlay puts the second swing on top of the first instead.

Sound is off until you turn it on under **?**. Hearing impact is useful.

## Good to know

- A slo-mo clip can be tens of megabytes. If the phone is full, saving fails with a clear message instead of a half-saved swing.
- iOS can still delete website data if the app is never opened. Swingframe asks for persistent storage. Add it to the Home Screen and open it now and then. Deleting the Home Screen icon can delete the saved swings.
- iPhone videos are often HEVC. Safari plays them. Some desktop browsers will not, and will show a message on the player. Review those clips on the phone.
- Frame stepping is only as precise as the browser's seek. The fps control sets the step size; it does not re-encode the video.
- There is no analytics and no backend. After the app files load, video never leaves the phone.
