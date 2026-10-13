# Firebase Setup — Odyssey

The Firebase config lives at the top of `src/app.jsx` (`firebaseConfig`). Enable **Firestore** in the Firebase Console, then under **Authentication → Sign-in method** enable:

- **Google** — the primary sign-in (popup). Set a project support email when prompted.
- **Email link (passwordless)** — the fallback option in the sign-in modal. This sends a sign-in link to the user's Gmail or other email inbox.

Under **Authentication → Settings → Authorized domains**, add every domain the site is served from (for example `yourname.github.io`). `localhost` is authorized by default; a domain missing from this list fails with "ACCESS DENIED - DOMAIN NOT AUTHORIZED".

The email-link flow must be enabled under **Authentication → Sign-in method → Email/Password → Email link (passwordless sign-in)**. Users enter their email address, receive a link, and return to the same site to complete sign-in.

## Collections

### `teams/{uid}`

One document per signed-in account; the document id is the Firebase Auth uid.

| Field | Type | Notes |
| --- | --- | --- |
| `teamName` | string | Shown on the leaderboard |
| `score` | number | +100 per solved clue |
| `cluesSolved` | number | Also the unlock cursor: clue number `cluesSolved + 1` is the open case |
| `lastSolvedAt` | timestamp \| null | Leaderboard tie-breaker (earlier wins) |

### `clues/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Same as the document id |
| `order` | number | 1, 2, 3… — clues are solved strictly in this order |
| `title` | string | |
| `riddle` | string | |
| `locationCoords` | GeoPoint, `{ lat, lng }`, or `[lat, lng]` | Where the pin appears |
| `passcodeHash` | string | SHA-256 hex of the passcode, trimmed and lower-cased |

### `intel_feed/{id}`

Posts on The Wire. The app reads the latest 60, newest by `timestamp`.

| Field | Type | Notes |
| --- | --- | --- |
| `teamName` | string | Copied from the poster's team |
| `message` | string | Up to 140 characters |
| `timestamp` | timestamp | Server time |
| `mapCoordinates` | `{ lat, lng }` \| null | Optional pin — real or bluff |

## Adding clues

Open the app, then in the browser DevTools console:

```js
await bakerStreet.hashPasscode("your answer"); // paste the result into passcodeHash
```

Create the clue documents in the Firebase Console with that hash. To try the app quickly, `await bakerStreet.seedSampleClues()` writes four demo clues around `MAP_CENTER` (passcodes: `221b`, `twelve`, `elementary`, `moriarty`); it needs write access to `clues`, so run it before locking the rules down.

## Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clues/{clueId} {
      allow read: if true;
      allow write: if false; // edit clues from the Firebase Console
    }
    match /teams/{uid} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.score == 0
        && request.resource.data.cluesSolved == 0;
      allow update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.teamName == resource.data.teamName
        && request.resource.data.cluesSolved == resource.data.cluesSolved + 1
        && request.resource.data.score == resource.data.score + 100;
      allow delete: if false;
    }
    match /intel_feed/{postId} {
      allow read: if true;
      // Signed-in agencies only, posting under their own team name
      allow create: if request.auth != null
        && request.resource.data.keys().hasOnly(['teamName', 'message', 'timestamp', 'mapCoordinates'])
        && request.resource.data.teamName ==
           get(/databases/$(database)/documents/teams/$(request.auth.uid)).data.teamName
        && request.resource.data.message is string
        && request.resource.data.message.size() > 0
        && request.resource.data.message.size() <= 140
        && request.resource.data.timestamp == request.time;
      allow update, delete: if false;
    }
  }
}
```

## Limits of a client-only hunt

Passcodes are checked in the browser. These rules stop a team from jumping more than one clue per write or inflating its score, but a determined player can still read sealed riddles from the network tab or advance without the right passcode. For a competitive event, move the passcode check into a Cloud Function and deny client updates to `teams`.

The Wire's 15-second posting cooldown is also client-side only; rules cannot rate-limit. Moderate by deleting documents from `intel_feed` in the Firebase Console.

The old `items`, `claims`, and `verification_codes` collections are no longer used and can be deleted from the Firebase Console.
