use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::thread;

use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{path::BaseDirectory, AppHandle, Manager};

enum AudioCmd {
    PlayAlarm { sound: String, volume: f32 },
    StartTicking { sound: String, volume: f32 },
    StopTicking,
}

#[derive(Clone)]
pub struct AudioController {
    tx: Sender<AudioCmd>,
}

impl AudioController {
    pub fn play_alarm(&self, sound: &str, volume: f32) {
        let _ = self.tx.send(AudioCmd::PlayAlarm {
            sound: sound.into(),
            volume,
        });
    }
    pub fn start_ticking(&self, sound: &str, volume: f32) {
        let _ = self.tx.send(AudioCmd::StartTicking {
            sound: sound.into(),
            volume,
        });
    }
    pub fn stop_ticking(&self) {
        let _ = self.tx.send(AudioCmd::StopTicking);
    }
}

fn load_sounds(dir: &PathBuf) -> HashMap<String, Vec<u8>> {
    let mut m = HashMap::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        eprintln!("audio: cannot read sounds dir {}", dir.display());
        return m;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("ogg") {
            if let (Some(stem), Ok(bytes)) = (
                path.file_stem().and_then(|s| s.to_str()).map(String::from),
                std::fs::read(&path),
            ) {
                m.insert(stem, bytes);
            }
        }
    }
    m
}

pub fn init(app: &AppHandle) -> AudioController {
    // In dev, sounds live next to src-tauri (../src-tauri/sounds); in production
    // they're bundled to the resource dir.
    let sounds_dir = app
        .path()
        .resolve("sounds", BaseDirectory::Resource)
        .or_else(|_| {
            app.path()
                .resource_dir()
                .map(|d| d.join("sounds"))
        })
        .unwrap_or_else(|_| PathBuf::from("sounds"));

    let (tx, rx) = mpsc::channel::<AudioCmd>();
    thread::spawn(move || run_audio_loop(rx, sounds_dir));
    AudioController { tx }
}

fn run_audio_loop(rx: mpsc::Receiver<AudioCmd>, sounds_dir: PathBuf) {
    let sounds = load_sounds(&sounds_dir);
    let (_stream, stream_handle) = match OutputStream::try_default() {
        Ok(x) => x,
        Err(e) => {
            eprintln!("audio: OutputStream init failed: {e}");
            return;
        }
    };
    let mut ticking_sink: Option<Sink> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            AudioCmd::PlayAlarm { sound, volume } => {
                if sound == "off" {
                    continue;
                }
                let Some(bytes) = sounds.get(&sound) else { continue };
                let Ok(sink) = Sink::try_new(&stream_handle) else { continue };
                let Ok(decoder) = Decoder::new(Cursor::new(bytes.clone())) else { continue };
                sink.set_volume(volume.clamp(0.0, 1.0));
                sink.append(decoder);
                sink.detach();
            }
            AudioCmd::StartTicking { sound, volume } => {
                if let Some(s) = ticking_sink.take() {
                    s.stop();
                }
                if sound == "off" {
                    continue;
                }
                let Some(bytes) = sounds.get(&sound) else { continue };
                let Ok(sink) = Sink::try_new(&stream_handle) else { continue };
                let Ok(decoder) = Decoder::new(Cursor::new(bytes.clone())) else { continue };
                sink.set_volume(volume.clamp(0.0, 1.0));
                sink.append(decoder.buffered().repeat_infinite());
                ticking_sink = Some(sink);
            }
            AudioCmd::StopTicking => {
                if let Some(s) = ticking_sink.take() {
                    s.stop();
                }
            }
        }
    }
}
