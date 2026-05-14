# FocusTimer

A Pomodoro focus timer for Windows. Tauri 2 (Rust backend) + vanilla JS/HTML/CSS frontend.

## Project layout

```
pomofocus/
├── app/                       The Tauri application
│   ├── src/                   Frontend (HTML/CSS/JS, no bundler)
│   │   ├── index.html
│   │   ├── main.js
│   │   ├── styles.css
│   │   ├── css/               Design tokens + per-area styles
│   │   └── js/                Per-feature ES modules
│   └── src-tauri/             Rust backend
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── capabilities/      Tauri 2 permissions
│       ├── icons/             App + tray icons
│       ├── sounds/            Bundled OGG alarms / ticking (GPL-3)
│       └── src/
│           ├── lib.rs         Builder + plugin registration
│           ├── main.rs        Bin entry
│           ├── timer.rs       Phase state machine + tick loop
│           ├── tasks.rs       Task CRUD (SQLite)
│           ├── settings.rs    Persisted preferences (JSON)
│           ├── db.rs          SQLite migrations + pool
│           ├── audio.rs       rodio playback thread
│           └── notify.rs      Toast notifications
└── FocusTimer-main/           Linux reference (git-ignored, not built)
```

## Develop

Prereqs: Rust 1.80+, Node 20+, MSVC build tools.

```powershell
cd app
npm install         # one-time
npm run dev         # cargo tauri dev under the hood
```

The app window opens at 380×600. Hot-reload is enabled for the frontend; Rust changes recompile on save.

## Build a Windows installer

```powershell
cd app
npm run build       # cargo tauri build — produces MSI + NSIS in app/src-tauri/target/release/bundle
```

## Data locations (Windows)

- Settings: `%APPDATA%\com.omars.focustimer\settings.json`
- Database: `%APPDATA%\com.omars.focustimer\focustimer.db` (WAL)

## Scripts

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `npm run dev`    | Run the desktop app with hot-reload           |
| `npm run build`  | Produce a release binary + installer          |
| `npm run format` | Format JS/CSS/HTML with Prettier              |
| `npm run check`  | `cargo check` + `cargo clippy` + format check |

## License

App code: MIT. Bundled sounds are reused from
[FocusTimer](https://github.com/focustimerhq/FocusTimer) under GPL-3; see
`app/src-tauri/sounds/CREDITS`. Distributions that ship those sound files
must comply with GPL-3.
