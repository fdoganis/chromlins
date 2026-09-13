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
