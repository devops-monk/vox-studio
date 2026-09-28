//! Quick Speak: a Spotlight-style panel on a global shortcut. Type, press Return, hear it.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const QUICK: &str = "quick";
pub const DEFAULT_SHORTCUT: &str = "Control+Alt+S";
pub const SELECTION_SHORTCUT: &str = "Control+Alt+R";
const WIDTH: f64 = 680.0;
const HEIGHT: f64 = 76.0;

#[derive(Default)]
pub struct QuickState {
    shortcut: Mutex<Option<Shortcut>>,
    selection_shortcut: Mutex<Option<Shortcut>>,
    pending: Mutex<Option<Pending>>,
}

/// What the panel should do when it next looks (it may still be loading on first use).
#[derive(Clone, serde::Serialize)]
pub struct Pending {
    pub text: Option<String>,
    pub notice: Option<String>,
}

pub fn take_pending(app: &AppHandle) -> Option<Pending> {
    app.state::<QuickState>().pending.lock().unwrap().take()
}

/// Speak Selection: grab the selected text from the focused app and read it in the panel.
pub fn speak_selection(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let pending = match crate::dictation::copy_selection(&app) {
            Ok(Some(text)) => Pending { text: Some(text), notice: None },
            Ok(None) => Pending { text: None, notice: Some("Select some text first, then press the shortcut.".into()) },
            Err(e) => Pending { text: None, notice: Some(e) },
        };
        *app.state::<QuickState>().pending.lock().unwrap() = Some(pending);
        let window = match app.get_webview_window(QUICK) {
            Some(w) => w,
            None => match create(&app) {
                Ok(w) => w,
                Err(e) => return eprintln!("[quick] couldn't create the panel: {e}"),
            },
        };
        show(&window);
        let _ = window.emit("quick://pending", ());
    });
}

/// Show the panel (creating it on first use), or hide it if it's already in front.
pub fn toggle(app: &AppHandle) {
    match app.get_webview_window(QUICK) {
        Some(w) if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) => {
            let _ = w.hide();
        }
        Some(w) => show(&w),
        None => match create(app) {
            Ok(w) => show(&w),
            Err(e) => eprintln!("[quick] couldn't create the panel: {e}"),
        },
    }
}

fn show(window: &tauri::WebviewWindow) {
    position_top_center(window);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("quick://open", ());
}

fn create(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    WebviewWindowBuilder::new(app, QUICK, WebviewUrl::App("index.html#/quick".into()))
        .title("Quick Speak")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .visible_on_all_workspaces(true)
        .build()
}

/// Where Spotlight sits: centred, a quarter of the way down the screen with the mouse.
fn position_top_center(window: &tauri::WebviewWindow) {
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|p| window.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let w = (WIDTH * scale) as i32;
    let x = monitor.position().x + (size.width as i32 - w) / 2;
    let y = monitor.position().y + (size.height as f64 * 0.24) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// The panel grows when it shows a result; the UI tells us how tall it needs to be.
pub fn resize(app: &AppHandle, height: f64) {
    if let Some(w) = app.get_webview_window(QUICK) {
        let _ = w.set_size(LogicalSize::new(WIDTH, height.clamp(HEIGHT, 420.0)));
    }
}

pub fn register_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    bind(app, accelerator, false)
}

pub fn register_selection_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    bind(app, accelerator, true)
}

fn bind(app: &AppHandle, accelerator: &str, selection: bool) -> Result<(), String> {
    let shortcut: Shortcut = accelerator.parse().map_err(|e| format!("Invalid shortcut “{accelerator}”: {e}"))?;
    let gs = app.global_shortcut();
    let state = app.state::<QuickState>();
    let mut current = if selection { state.selection_shortcut.lock().unwrap() } else { state.shortcut.lock().unwrap() };
    if let Some(old) = current.take() {
        let _ = gs.unregister(old);
    }
    gs.on_shortcut(shortcut, move |app, _shortcut, event| match (selection, event.state) {
        (false, ShortcutState::Pressed) => toggle(app),
        // On release, so the shortcut's keys don't mix with the ⌘C we send.
        (true, ShortcutState::Released) => speak_selection(app),
        _ => {}
    })
    .map_err(|e| format!("Couldn't use “{accelerator}” — another app may already use it ({e})"))?;
    *current = Some(shortcut);
    Ok(())
}
