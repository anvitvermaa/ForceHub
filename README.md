<div align="center">
  <img src="extension/icons/icon128.png" width="100" alt="ForceHub Logo"/>

  <h1>ForceHub</h1>

  <p>A Chrome extension that automatically syncs your accepted Codeforces submissions to GitHub — with full history backfill and a built-in analytics dashboard.</p>

  [![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)](https://github.com/anvitvermaa/ForceHub)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Known Issues](#known-issues)
- [Contributing](#contributing)
- [License](#license)
- [Author](#author)

---

## Description

ForceHub is a Chrome extension that pushes every accepted Codeforces submission to a GitHub repository of your choice — in real time. It also supports backfilling your entire submission history, so your GitHub graph reflects all your past work. A built-in analytics dashboard gives you a breakdown of your solve streaks, rating progression, and language usage.

---

## ✨ Features

- **Real-Time Sync** — Every new accepted submission is pushed to GitHub automatically.
- **Full History Backfill** — Push all your past accepted submissions in one click.
- **Analytics Dashboard** — View your solve streaks, rating history, language breakdown, and a GitHub-style heatmap.
- **Secure & Local** — API keys and tokens are stored locally in Chrome storage. Nothing is sent to any third-party server.
- **Flexible Repo Setup** — Link any existing GitHub repository or configure a new one from the settings page.

---

## 🚀 Installation

Install ForceHub directly from the [Chrome Web Store](#) *(link coming soon)*.

---

## Usage

**1. Link Codeforces**
Open the extension popup and enter your Codeforces handle along with your API Key and Secret. These can be generated at [codeforces.com/settings/api](https://codeforces.com/settings/api).

**2. Link GitHub**
Go to the Settings page and enter your GitHub Personal Access Token (needs `repo` scope) and the repository name where solutions should be pushed. Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens).

**3. Sync**
Once linked, ForceHub will automatically push every new accepted submission. To backfill past submissions, click **Backfill History** in the settings.

**4. Analytics**
Open the Analytics Dashboard from the popup to view your solve heatmap, streak, rating chart, and language breakdown.

---

## ⚠️ Known Issues

- **Contest Submissions** — The Codeforces API does not expose submission source code during an active contest. Submissions will sync automatically after the contest ends.
- **Rate Limits** — Rapid consecutive accepted submissions may be delayed due to GitHub or Codeforces API rate limits. Use the backfill option to recover any missed ones.

---

## 🤝 Contributing

Contributions are welcome. To contribute:

1. Fork the repository.
2. Create a new branch for your change.
3. Commit with a clear message.
4. Open a Pull Request.

For significant changes, open an issue first to discuss the approach.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Anvit Verma**
- 💼 [LinkedIn](https://www.linkedin.com/in/anvit-verma/)
- 📧 [Email](mailto:anvitvermaa@gmail.com)
- 🐙 [GitHub](https://github.com/anvitvermaa)

---

Found a bug or have a feature request? [Open an issue](https://github.com/anvitvermaa/ForceHub/issues).
