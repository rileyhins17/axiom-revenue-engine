# iPhone home-screen app

The engine is a private web app: no App Store or developer account.

## Install

1. On the iPhone, open Safari (profiles only install from Safari) and go to
   `https://operations.getaxiom.ca/install`.
2. Tap **Download profile**, then **Allow**.
3. Open Settings, tap **Profile Downloaded**, then **Install**, enter the passcode and
   tap **Install** again.
4. Open **Axiom Revenue** from the home screen and sign in with the emailed code.

The profile is built by `/api/ios-profile` from the live `APP_BASE_URL`, so it always
opens the live app. It's unsigned on purpose (two people, one removable web clip), so iOS
warns about that.

If the profile is awkward: in Safari open `https://operations.getaxiom.ca/dashboard`,
tap Share, then **Add to Home Screen**.

## If the icon is old or opens a missing page

Delete the old icon (and its profile in Settings > General > VPN & Device Management),
then install again.

## After a release

These must answer `200`: `/manifest.webmanifest`, `/apple-touch-icon.png`,
`/icons/icon-192.png`, `/icons/icon-512.png`, `/sw.js` and `/install`.
