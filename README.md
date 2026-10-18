# Swingframe

A mobile-first golf swing notebook for Scott. Record a swing or pull one in from the camera roll, tag it **Down the Line** or **Face On**, then scrub it frame by frame and draw on it. Videos and drawings stay on that phone. There is no Swingframe account. Nothing is uploaded unless you connect your own Google Drive.

It is a static web app, built to be added to an iPhone Home Screen and used one-handed on the range.

## What's in this version

- **Capture.** Record with the phone camera, or choose an existing video (including slo-mo from the Camera app). Each swing is tagged Down the Line or Face On, with an optional date, club, and notes. Club chips include the wedges PW, GW, SW, and LW.
- **Library.** A list on this phone. Filter by club (All, Driver, Iron, Wedge) and by view (All, DTL, FO) together. Woods, hybrids, and the putter stay under All clubs. Stored in IndexedDB. Each video is saved as bytes plus its MIME type (not a Blob URL and not a Blob value), because iOS drops Blob values when the Home Screen app closes. The player rebuilds a Blob from those bytes when you open the swing. Swipe a card left to delete it, or tap Select to delete several. Deleting removes the video, thumbnail, and drawings.
- **Playback.** The video stays inside the page. It does not open the iPhone's full-screen player, so the drawing tools stay on screen. A white bar at the bottom has the speed, frame step, play, clear, undo, and a wrench. Undo and Clear all are dimmed until there is something to change. Drag the time at the top right, or the thin bar, to scrub. Speeds are 1×, ½, ¼, and 0.1×. The frame step size is 30, 60, 120, or 240 fps, saved with the swing. Sound, loop, details, and delete are under the ? button.
- **Drawing.** The video fills the screen. A round X, the time, and ? sit on top of it. The white bar has speed, color, frame step, play, clear, undo, and the wrench. Clear all asks first, then removes every drawing, and Undo can put them back. Open the wrench, pick a tool, and it closes so you draw on the full frame. Lines, circles, boxes, angles, freehand, and level lines are placed with two fingers (each finger is one end of a line; pinch sizes a circle or box; the angle joint sits between the fingers). Move uses two fingers to drag, pinch, and turn a drawing, and one finger on the white handles to fine-tune. Pinch-zoom is only on while Pinch is selected in the wrench. Drawings stay in the video's own coordinates.
- **Compare.** Pick two swings. In portrait they stack; turn the phone sideways (or use a wide window) and they sit side by side. Each clip scrubs on its own. Sync matches progress through the swing, so the second clip follows the one you play or scrub. Synced playback plays one video and seeks the other, which is the reliable way to do this on an iPhone.
- **Installable.** Web app manifest, home screen icons, standalone display, and a service worker so the app shell loads offline after the first visit. Saved videos are already on the device and do not need the network.
- **Google Drive.** Optional. If this build has a Google client id, the library has a Google Drive button and the player ? menu can back up the open swing. Back up sends the video, thumbnail, and a small JSON file (details, drawings, and the shot tracer) into a Swingframe folder in that Google account. Cards show a Drive badge. Free up space deletes the local video only after that backup, and leaves the card. Download from Drive puts the video back. Restore from Drive imports swings that are in the folder but not on this phone. Without a client id, none of these controls appear.
- **Tracer.** A broadcast-style ball flight drawn on the swing. Open the wrench and tap Tracer. Add a screenshot of the Foresight shot screen, or type ball speed, launch, spin, and the club numbers (path, face to target, face to path). The reading happens on the phone. Signed numbers use L and R, because the iPhone keypad has no minus. Check the numbers, tap the ball, then tap a point up the aim line. That tap is the intended direction only. Launch direction is degrees off that line, and spin bends the ball off that start line — the stroke is a curve, not a straight tilt — so the landing can finish left or right of the aim line. The line is a ground-plane projection: it ends at height zero, wherever launch and spin put it. Nudge camera height, distance, and field of view if the arc looks the wrong size. The tracer panel scrolls above the play bar. Pause on the hit and tap Set impact time on the bar (sound detection is only a backup). Play, and the line grows with the video, including slow motion, until the ball lands. If the clip is shorter than the flight, the tracer finishes on the last frame. Clear tracer removes the numbers and the line. Undo puts them back. Clear all still clears drawings only.

## What's next

- Read the real frame rate out of the file, instead of a 30/60/120/240 step setting.
- Sync two angles on an impact frame you tap, not only by percent through the clip.
- Export a still with the drawings burned in.
- Export a backup you can move without a Google account.
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
2. Down the Line is already selected. Change it if this swing is Face On, then tap Save. The button stays on screen. Closing with the X asks before it discards the video.
3. Open the swing. The picture stays in the page. Tap **?** and set **Step** to 120 or 240 if one tap jumps several frames, or lower it if a tap barely moves.
4. Tap the wrench, choose Line, and place two fingers on the ends of the line. Lift to commit. Undo on the white bar steps back. Clear all, next to Undo, removes every drawing after a confirm, and Undo can restore them. Pinch-zoom only works after you pick Pinch in the wrench.
5. Drag the time at the top, or the thin bar, to scrub. The speed pill cycles 1x, 0.5x, 0.25x, and 0.1x.
6. To compare a Down the Line and a Face On of the same swing, save both, open the wrench, tap Compare, and turn Sync on. Overlay puts the second swing on top of the first instead.
7. To remove a swing, swipe it left in the library and tap Delete, or tap Select and delete several. Delete swing is also under ? while it is open. The storage line updates after the video is gone.
8. For a tracer, open the wrench, tap Tracer, and add the Foresight screenshot (or type ball speed, launch angle, and spin). Use L or R on direction, spin axis, club path, and face angles. Tap the ball in the video, then a point up the aim line. Launch direction and spin axis are degrees off that line. The ball lands where those numbers put it, not on the aim point. If the arc is the wrong size, move camera height, distance, or field of view. Close the panel, pause on the hit, and tap **Set impact time** on the white bar. The line stays hidden until that frame, then grows until it lands. Clear tracer, in the tracer panel, removes it. Undo on the bar puts it back.

Sound is off until you turn it on under **?**. Hearing impact is useful.

## Good to know

- A slo-mo clip can be tens of megabytes. If the phone is full, or the save does not stick, Swingframe shows an error and does not pretend the swing is in the library.
- The database name is `swingframe` on this site. It does not change with the `/swingframe/` path, and a service worker update does not erase it. The first save also asks the browser to keep storage (`navigator.storage.persist()`).
- Swings saved on iPhone before this byte-storage fix can already be gone. iOS removed those Blob records when the app was closed. Import them again. New saves stay across launches.
- iOS can still delete website data if the app is never opened, or if it refuses persistent storage. Add Swingframe to the Home Screen and open it now and then. Deleting the Home Screen icon can delete the saved swings.
- iPhone videos are often HEVC. Safari plays them. Some desktop browsers will not, and will show a message on the player. Review those clips on the phone.
- Frame stepping is only as precise as the browser's seek. The fps control sets the step size; it does not re-encode the video.
- There is no analytics and no backend. Video leaves the phone only when you tap a Google Drive backup, and then only to your own Drive. The shot tracer reads a screenshot on the phone. It does not send the picture anywhere. Carry, apex, and curve are filled in with a simplified drag-and-lift model when the screenshot does not show them. That model is approximate, not a copy of the GCQuad. The camera is a simple pinhole you can nudge. It is not a measured lens calibration.

- Google sign-in on the iPhone home screen uses a full-page redirect, because a popup cannot talk back to the installed app. In Safari or desktop Chrome it tries a popup first, and switches to the full page if the popup is blocked. The sign-in lasts about an hour.

## Connect Google Drive

Swingframe talks to Google from the phone. There is no server in the middle. The client id is baked in when GitHub Actions builds the site. If the id is missing, the Drive buttons stay hidden and the rest of the app works as before.

Do this once, signed in as the Google account that should own the backups (Scott's Gmail is fine).

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project named **Swingframe**.
2. Go to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen**. Choose **External** and create the app. App name: Swingframe. User support email and developer contact: your Gmail. Save.
4. On the consent screen, open **Data access** (or Scopes) and add this scope: `https://www.googleapis.com/auth/drive.file`. The description is that the app can see, edit, create, and delete only the Drive files it uses. Do not add full Drive access.
5. Add your own Gmail under **Test users**. Leave the app in **Testing**. Do not click Publish. In testing mode only those test users can sign in, which is what you want.
6. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Application type: **Web application**. Name it Swingframe.
7. Under **Authorized JavaScript origins** add `https://scottleland-glitch.github.io` (no path, no trailing slash).
8. Under **Authorized redirect URIs** add `https://scottleland-glitch.github.io/swingframe/` (with the path and the trailing slash). The popup sign-in uses the JavaScript origin. The iPhone home-screen sign-in uses the redirect URI.
9. Create the client and copy the **Client ID**. It ends in `.apps.googleusercontent.com`. You do not need the client secret.
10. On GitHub, open the `swingframe` repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**. Name it exactly `VITE_GOOGLE_CLIENT_ID`. Paste the client id as the value. This is not a secret: it is visible in the built web app.
11. Run the **Deploy GitHub Pages** workflow again (Actions → Deploy GitHub Pages → Run workflow), or push a commit. The build reads that variable. An old deploy does not pick it up by itself.
12. On the iPhone, close Swingframe fully and open it again. The library subtitle should say **Version 13**, and **Google Drive** should appear under the storage line. Tap it, then **Connect Google Drive**. Choose the same Gmail you added as a test user. Back up a swing, then **Free up space** if the phone is full. Open that swing and tap **Download from Drive** to get the video back.

To try this on a computer, also add `http://localhost:5173` as a JavaScript origin and `http://localhost:5173/swingframe/` as a redirect URI, and start the dev server with `VITE_GOOGLE_CLIENT_ID=your-id npm run dev`. The phone does not need that.
