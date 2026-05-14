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

## Manual QA checklist

Run `npm run dev` and walk through:

- [ ] Timer: start a pomodoro, watch the ring count down, then pause/resume.
- [ ] Skip phase advances to the next phase; reset returns to Stopped.
- [ ] After 4 pomodoros (configure a 1-minute duration if you don't want
      to wait), the cycle dots fill and the next break is a long break.
- [ ] Add a task. Click it to set it current — the "Now focusing on"
      headline updates. Complete a pomodoro and the task's N/M increments;
      reaching the estimate auto-completes the row and rolls current.
- [ ] Drag a task to reorder. Inline-edit by clicking the title.
- [ ] Settings: change a duration, verify the timer reflects the new
      target on the next start. Toggle alarm and ticking sounds, theme.
- [ ] Notifications: a Windows toast appears when a phase ends. With
      "Announce 30s before end" on, a soft toast 30 s before each phase.
- [ ] Tray: close the window → it hides to tray. Left-click the tray
      icon → window restores. Tray tooltip shows MM:SS while running.
- [ ] Hotkeys: Ctrl+Alt+P starts/pauses, Ctrl+Alt+S skips,
      Ctrl+Alt+R resets — even when the window is minimized.
- [ ] Stats: the bar chart fills after each completed pomodoro;
      today/streak update without reopening the screen.
- [ ] Lock the workstation (Win+L) while a pomodoro is running — the
      timer pauses. Unlock → it resumes.
- [ ] Restart the app — settings, tasks, and stats persist.

## License

App code: MIT. Bundled sounds are reused from
[FocusTimer](https://github.com/focustimerhq/FocusTimer) under GPL-3; see
`app/src-tauri/sounds/CREDITS`. Distributions that ship those sound files
must comply with GPL-3.
