//! Background poller that pauses the timer when the Windows workstation is
//! locked and resumes it when unlocked.
//!
//! We avoid the full WTSRegisterSessionNotification dance (which needs a
//! window message loop) by polling the input desktop name every 2s. When the
//! session is locked, the input desktop becomes "Winlogon"; under normal use
//! it's "Default". Polling adds negligible CPU.

#![cfg(windows)]

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{BOOL, HANDLE};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_ACCESS_FLAGS,
    DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS, DESKTOP_SWITCHDESKTOP, UOI_NAME,
};

use crate::settings::SettingsStore;
use crate::timer::TimerEngine;

const POLL_MS: u64 = 2000;

fn is_locked() -> bool {
    unsafe {
        let access = DESKTOP_ACCESS_FLAGS(DESKTOP_READOBJECTS.0 | DESKTOP_SWITCHDESKTOP.0);
        let hdesk = match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), BOOL(0), access) {
            Ok(h) => h,
            Err(_) => return true,
        };
        let mut buf = [0u16; 64];
        let mut needed = 0u32;
        let handle = HANDLE(hdesk.0);
        let ok = GetUserObjectInformationW(
            handle,
            UOI_NAME,
            Some(buf.as_mut_ptr() as *mut _),
            (buf.len() * 2) as u32,
            Some(&mut needed),
        );
        let _ = CloseDesktop(hdesk);
        if ok.is_err() {
            return true;
        }
        let len = (needed.saturating_sub(2) as usize / 2).min(buf.len());
        let name = String::from_utf16_lossy(&buf[..len]);
        !name.eq_ignore_ascii_case("Default")
    }
}

pub fn spawn(app: AppHandle, settings: SettingsStore) {
    thread::spawn(move || {
        let mut prev_locked = false;
        let mut auto_paused = false;
        loop {
            thread::sleep(Duration::from_millis(POLL_MS));
            if !settings.lock().pause_on_lock {
                continue;
            }
            let locked = is_locked();
            if locked == prev_locked {
                continue;
            }
            prev_locked = locked;
            let engine = match app.try_state::<TimerEngine>() {
                Some(e) => e,
                None => continue,
            };
            if locked {
                let snap = engine.snapshot();
                if snap.is_running {
                    engine.pause();
                    auto_paused = true;
                }
            } else if auto_paused {
                engine.resume();
                auto_paused = false;
            }
        }
    });
}
