# Chromlins

A WebXR AR whack-a-mole game for js13k 2026. Color spirits, the Chromlins,
have stolen the seven colors of the rainbow and hidden a unicorn. Find them
peeking out of holes in your real table and tap them to take the colors
back; leave the unicorn alone.

Built on [gamma](https://github.com/fdoganis/gamma), a WebXR engine by the
same author. If you're looking to build your own game rather than fork this
one, start there instead.

## The story

The seven colors of the rainbow have been stolen by the Chromlins, mischievous
color spirits who hide in holes in your table and peek out just long enough
to taunt you. Each one carries a single stolen color. Tap a Chromlin and its
color returns to the rainbow for good, it never comes back to steal again.

A unicorn is trapped among them too, peeking out just like the Chromlins do.
Leave it alone. Tapping the unicorn undoes your progress instead of helping
it, and only makes the Chromlins bolder.

Clear all seven colors before the timer runs out and the rainbow is restored.
Miss the timer, and the Chromlins keep their haul. Try again.

**NOTE**: TypeScript is only used to enforce type checks while coding. All types are simply erased by the transpiler. See `tsconfig.json` and this [article](https://www.sitepoint.com/typescript-58-erasable-syntax-running-ts-directly-in-nodejs/) to understand how this works.

## Installation

Install [Node.js](https://nodejs.org)

- Clone or download repo
- run `npm install` : fetches and install all dependencies
- `npm run dev` : launches a server and opens your browser in `https://localhost:5173` by default
  - Edit your code : your changes are reflected instantly!
- `npm run build` : packages all code and resources into the `dist` folder, ready for deployment.

## Fitting in 13 kB

js13k allows 13,312 bytes, zipped. `npm run build` alone does not get there, the
packing pipeline does.

- `npm run pack` : build, then minify through Closure, pack with roadroller and
  zip with Zopfli, into `build/chromlins.zip`. This is the artifact that ships.
  It prints the final size and fails if it is at or over the limit.
- `npm run pack:fast` : same, but the quick settings, for iterating. A few
  hundred bytes larger, so never use it to judge whether you fit.
- `npm run deadcode` : lists class members nothing reachable ever calls. Add
  `--safe` for the ones you can delete in place with no caller to edit, or
  `--tree` to see each dead root with everything only it keeps alive.

Two things worth knowing before you try to save bytes:

**The size drifts by 10-20 bytes between identical builds.** Closure and
roadroller both make non-deterministic choices. If you land a few bytes over,
re-run `npm run pack`, that is normal practice here, not cheating.

**Shortening text saves nothing.** Cutting 10 characters of on-screen wording
measured 2 bytes: roadroller compresses prose almost for free. Bytes come from
removing whole behaviours, not from shortening strings.

### `PACK_EXTERNS=three` (opt-in, ~360 bytes)

    PACK_EXTERNS=three npm run pack

By default the packer protects every property name in the code from being
renamed, which also prevents Closure from *removing* anything unreachable. This
mode instead protects only what is genuinely external, three.js's API and the
WebXR/browser surface, generated automatically from `package.json`'s real
dependencies and this project's own `tsconfig.json` (`scripts/gen-external-api-
names.mjs`, no hardcoded package list), plus a small, explicit set of our own
dynamic-dispatch names (`scripts/gen-record-keys.mjs`). Closure is then
free to rename and drop our own dead code by itself, worth about 360 bytes here
with no source changes.

It is opt-in because a renaming mistake fails **silently at runtime**, not at
build time. `npm run smoke` will not catch it, it never enters an XR session.
Always verify with `npx playwright test tests/packed.spec.ts`, which drives the
real packed artifact through a round, and test on a device before shipping.

Adding a real npm dependency, or a `@types/*` devDependency for a browser API
your own code never touches (like `@types/webxr`), needs no edit here, it is
picked up automatically. See `.doc/DECISIONS.md` D18 for the full pipeline
write-up and its limitations.

## HTTPS

HTTPS is required to use the WebXR API


### Using Cloudflare Tunnel for free without an account or a domain (recommended)

  - Install [Homebrew](https://brew.sh)

```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

then follow instructions


```bash
echo >> /Users/XXX/.zprofile

echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> /Users/XXX/.zprofile

eval "$(/opt/homebrew/bin/brew shellenv)"
```

  - **[Install `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)**

```bash
brew install cloudflared
```
- run your app locally

```bash
npm run dev
```

- run `cloudflared` tunnel

```bash
cloudflared tunnel --url http://localhost:5173/
```

This will create a random temporary address ending in `*.trycloudflare.com`

You can share this address by sending a link or by generating a QR code (very useful for mobile devices and some XR headsets).

### Persistent link

If you want more persistence, you should register a domain name, or connect your github account to [Cloudflare Pages](https://pages.cloudflare.com) for free.

Alternatively, you could simply [use GitHub Pages to host your application persistently](https://sbcode.net/threejs/github-pages/).

### Tunneling alternatives

Check these tunneling alternatives such as `ngrok` or `zrok` for simple personal projects, use [tunneling solutions](https://github.com/anderspitman/awesome-tunneling) 


### Manual HTTPS setup

In order to use `https`, copy your certificates to the `.cert` folder, and change the `serve` command to:

`"serve": "http-server dist -S -C .cert/cert.pem -K .cert/key.pem`

## Testing a packed build on a real device

`npm run dev` serves live, unminified source, which is what you want while
writing code, but it is not what ships. Before trusting that a change works,
test the actual packed artifact (the same `build/chromlins.zip` a player or a
judge would get) on a real headset or phone:

```bash
npm run pack                       # or e.g. PACK_EXTERNS=three npm run pack
npm run device-test                # unzips it and serves it on port 5173
```

Then, in another terminal:

```bash
npm run cloud
```

`cloudflared` prints a `*.trycloudflare.com` URL, open that on the device (or
turn it into a QR code) and press "START XR".

`device-test` auto-generates a full command list; the short version of what it
does: unzips `build/chromlins.zip` into a scratch folder, frees port 5173 if
something else (a previous run, a stray `npm run dev`) is already holding it,
and serves that folder there, since `npm run cloud` always tunnels that
specific port. Ctrl+C to stop it. Pass a different zip path as an argument
(`npm run device-test -- path/to/other.zip`) to test something other than the
default build.

**Why this matters, not just `npm run smoke`:** the smoke test never opens a
WebXR session, so it happily passes on a build where XR is completely broken.
A packed build changes real things a dev build doesn't exercise the same way,
minification, the roadroller unpacking step, and (if `PACK_EXTERNS=three` is
in play) whether a property got renamed out from under a call site. The closest
automated equivalent is `npx playwright test tests/packed.spec.ts`, which
drives an emulated controller through a real round on the packed artifact, but
an emulator is not every browser: this project's mobile-AR select bug (see
`.doc/DECISIONS.md`) only ever showed up on a real device.

## Deploying the App with GitHub Pages

(original: https://github.com/meta-quest/webxr-first-steps?tab=readme-ov-file#build-and-deploy)

This repository includes a ready-to-use GitHub Actions workflow located at `.github/workflows/deploy.yml`, which automates both the build and deployment to GitHub Pages. Once enabled, every time you push changes to the `main` branch, a new build will automatically be deployed.

#### Steps to Enable GitHub Pages Deployment:

Your app will be deployed to https://[GITUSERNAME].github.io/[REPOSITORY_NAME] (for example https://fdoganis.github.io/three_vite_xr)

1. **Fork this repository** to your own GitHub account.
2. Navigate to your forked repository’s **Settings**.
3. Scroll down to the **Pages** section.
4. Under **Build and Deployment**, change the **Source** to **GitHub Actions**.

Once this is set, GitHub Actions will handle the build and deployment process automatically. Any time you push changes to the `main` branch, the app will be built and deployed to GitHub Pages without any additional manual steps.

You can monitor the status of the deployment job or manually re-run it via the **Actions** tab in your GitHub repository.

### Deploying to Your Own Hosting Solution

If you prefer to host the app yourself, you’ll need to manually build the app and then deploy the generated files to your hosting provider.

To generate the build, run the following command:

```bash
npm run build
```

This will create a `dist` folder containing the static files for the app. You can then upload these files to your hosting platform of choice.


# License

All rights reserved, see `LICENSE`. Published so the game and its source can
be reviewed, played, and judged for js13k 2026. The engine it's built on,
[gamma](https://github.com/fdoganis/gamma), is separately MIT licensed, see
gamma's own README for its engine-level credits (three_vite,
webxr-first-steps, etc.).

# Credits

Third-party code and assets bundled into this specific game, see
[`CREDITS.md`](./CREDITS.md).
