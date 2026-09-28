//! System-wide dictation: a global shortcut shows a floating "pill" window that listens,
//! and the recognised text is typed into whatever app had focus (clipboard + ⌘V).

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const PILL: &str = "dictation";
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const PILL_SIZE: (f64, f64) = (420.0, 88.0);

#[derive(Default)]
pub struct DictationState {
    shortcut: Mutex<Option<Shortcut>>,
}

#[derive(Serialize)]
pub struct InsertResult {
    /// True when the text was typed into the focused app; false when it was only copied.
    pub pasted: bool,
}

/// Show the pill (creating it on first use) and tell it to start or stop listening.
pub fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(PILL) else {
        // First use: the page starts listening as soon as it loads (an event sent now would be
        // lost, because the page isn't listening for it yet).
        match create_pill(app) {
            Ok(w) => {
                position_bottom_center(&w);
                let _ = w.show();
            }
            Err(e) => eprintln!("[dictation] couldn't create pill: {e}"),
        }
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        position_bottom_center(&window);
        let _ = window.show(); // shown without focus, so the target app keeps it
    }
    let _ = app.emit_to(PILL, "dictation://toggle", ());
}

fn create_pill(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    WebviewWindowBuilder::new(app, PILL, WebviewUrl::App("index.html#/pill/start".into()))
        .title("Dictation")
        .inner_size(PILL_SIZE.0, PILL_SIZE.1)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .build()
}

fn position_bottom_center(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let w = (PILL_SIZE.0 * scale) as i32;
    let h = (PILL_SIZE.1 * scale) as i32;
    let x = monitor.position().x + (size.width as i32 - w) / 2;
    let y = monitor.position().y + size.height as i32 - h - (96.0 * scale) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

pub fn register_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator.parse().map_err(|e| format!("Invalid shortcut “{accelerator}”: {e}"))?;
    let gs = app.global_shortcut();
    let state = app.state::<DictationState>();
    let mut current = state.shortcut.lock().unwrap();
    if let Some(old) = current.take() {
        let _ = gs.unregister(old);
    }
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    })
    .map_err(|e| format!("Couldn't use “{accelerator}” — another app may already use it ({e})"))?;
    *current = Some(shortcut);
    Ok(())
}

/// Put `text` into the app that had focus: copy it, press ⌘V (Ctrl+V elsewhere), then put
/// the user's previous clipboard back.
pub fn insert(app: &AppHandle, text: &str, paste: bool) -> Result<InsertResult, String> {
    if let Some(w) = app.get_webview_window(PILL) {
        let _ = w.hide();
    }
    if text.trim().is_empty() {
        return Ok(InsertResult { pasted: false });
    }
    let clipboard = app.clipboard();
    let previous = clipboard.read_text().ok();
    clipboard.write_text(text.to_string()).map_err(|e| e.to_string())?;
    if !paste || !accessibility_trusted() {
        return Ok(InsertResult { pasted: false }); // leave it on the clipboard for ⌘V
    }
    thread::sleep(Duration::from_millis(120)); // let the pill disappear and focus settle
    send_paste().map_err(|e| format!("Couldn't paste: {e}"))?;
    if let Some(prev) = previous {
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(600));
            let _ = app.clipboard().write_text(prev);
        });
    }
    Ok(InsertResult { pasted: true })
}

fn send_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let modifier = if cfg!(target_os = "macos") { Key::Meta } else { Key::Control };
    enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
    let result = enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string());
    enigo.key(modifier, Direction::Release).map_err(|e| e.to_string())?;
    result
}

/// macOS only lets apps send keystrokes to other apps with Accessibility permission.
#[cfg(target_os = "macos")]
pub fn accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
pub fn accessibility_trusted() -> bool {
    true
}

pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}
