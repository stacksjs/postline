# GitHub Actions

CI and the desktop release do not run here. They run on ReviewOS, from
`.reviewos/workflows`; see [docs/ci.md](../../docs/ci.md).

What is left in this folder runs on GitHub because it acts on GitHub itself:

- `buddy-bot.yml`: opens dependency update pull requests
- `labeler.yml`: labels pull requests by the paths they touch
- `export-size.yml`: reports bundle size on a pull request
- `apple-app-store.yml`: Mac App Store packaging and upload, started by hand
