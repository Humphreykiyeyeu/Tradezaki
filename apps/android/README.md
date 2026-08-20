# Tradezaki for Android

A native shell around the Tradezaki web app.

## Why a shell and not a rewrite

The web app is already responsive and already holds the whole product: the
terminal, the bot builder, analytics, risk limits. Rebuilding that in React
Native would duplicate every screen and every bug fix from here on, for an
audience whose actual complaint — "my bot stops when I close the tab" — is
solved on the server, not on the phone.

What a shell buys that a browser tab does not:

- An icon on the home screen, which is how this audience opens things
- A place to receive push notifications when a bot stops (PLAN.md §10, next up)
- Full screen, no browser chrome, no accidental tab closing
- A session that survives the app being backgrounded

What it deliberately does not do is reimplement trading. There is one codebase
for that and it is `apps/web`.

## Build

Requires JDK 17 and the Android SDK. `local.properties` points at the SDK and is
gitignored.

```bash
./gradlew assembleRelease     # signed APK, see app/build.gradle.kts
./gradlew assembleDebug       # unsigned, for a quick check
```

The release APK lands in `app/build/outputs/apk/release/`.

## Signing

The release key lives outside the repo at `~/.tradezaki/android-release.keystore`
with its passwords in `~/.tradezaki/keystore.properties`. Both are deliberately
outside version control: an APK signed with a leaked key can be replaced by
anyone, and Android identifies an app by its signature for its whole life — a
lost or leaked key cannot be rotated without shipping a different app.

**Back that keystore up somewhere you will still have in five years.**
