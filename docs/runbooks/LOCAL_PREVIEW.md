# Looking at the screens on your own computer

For checking a screen change before a release. It uses a local SQLite file of made-up data. It never touches the live database, has no inbox passwords and can't send email.

```bash
npm ci
npx tsx scripts/demo-data.ts ./data/demo.db          # "busy": things need a founder. Also: calm, empty
APP_BASE_URL=http://localhost:3000 \
BETTER_AUTH_SECRET=local-preview-only-not-a-real-secret-0123456789 \
AUTH_PASSWORD_SIGNIN=true AXIOM_LOCAL_SYNTHETIC_SIGNUP=1 \
AUTH_ALLOWED_EMAILS=riley@getaxiom.ca,aidan@getaxiom.ca \
DATABASE_PATH=./data/demo.db \
FCC_CAMPAIGN_MAILING_ADDRESS="100 Example Street, Kitchener, ON N0N 0N0, Canada" \
npm run dev
```

Then make the two local founders once (local only: the live app signs in by emailed code and refuses this):

```bash
curl -X POST http://localhost:3000/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"email":"aidan@getaxiom.ca","password":"local-preview-pass-123","name":"Aidan"}'
```

Sign in at `http://localhost:3000/sign-in` is by code on the live app; locally, sign in with the same request to `/api/auth/sign-in/email` (a browser test does this with its own cookie jar), or keep the cookie the sign-up returned.

- Aidan is the demo campaigns' approver, so he sees the Approve cards; Riley sees "waits for Aidan".
- `./data/` is ignored by git. Every person, place and address in the demo data is invented; keep it that way, this repository is public.
- Screenshots for a pull request come from this copy, never from the live app.
