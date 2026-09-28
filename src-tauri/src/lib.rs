//! VoxStudio desktop shell: window, glass effects, the voxd supervisor, dictation and tray.

mod dictation;
mod voxd;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, State};
use dictation::{DictationState, InsertResult};
use voxd::{Voxd, VoxdState};

#[tauri::command]
fn voxd_state(voxd: State<'_, Voxd>) -> VoxdState {
    voxd.state()
}

#[tauri::command]
fn voxd_logs(voxd: State<'_, Voxd>) -> Vec<String> {
    voxd.logs()
}

#[tauri::command]
fn voxd_restart(voxd: State<'_, Voxd>) {
    voxd.restart();
}

/// Lets the UI (including windows without devtools, like the dictation pill) write to the app log.
#[tauri::command]
fn client_log(voxd: State<'_, Voxd>, source: String, message: String) {
    voxd.log(format!("[ui:{source}] {message}"));
}

#[derive(Serialize)]
struct DictationStatus {
    shortcut: String,
    accessibility: bool,
}

#[tauri::command]
fn dictation_toggle(app: AppHandle) {
    dictation::toggle(&app);
}

#[tauri::command]
fn dictation_insert(app: AppHandle, text: String, paste: bool) -> Result<InsertResult, String> {
    dictation::insert(&app, &text, paste)
}

#[tauri::command]
fn dictation_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(dictation::PILL) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn dictation_set_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    dictation::register_shortcut(&app, &accelerator)
}

#[tauri::command]
fn dictation_status() -> DictationStatus {
    DictationStatus { shortcut: dictation::DEFAULT_SHORTCUT.into(), accessibility: dictation::accessibility_trusted() }
}

#[tauri::command]
fn dictation_open_accessibility() {
    dictation::open_accessibility_settings();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let dictate = MenuItemBuilder::with_id("dictate", "Start dictation").accelerator(dictation::DEFAULT_SHORTCUT).build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open VoxStudio").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit VoxStudio").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&dictate, &open, &PredefinedMenuItem::separator(app)?, &quit]).build()?;
    TrayIconBuilder::with_id("voxstudio")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip("VoxStudio")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dictate" => dictation::toggle(app),
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(DictationState::default())
        .setup(|app| {
            let voxd = Voxd::new(app.handle().clone());
            voxd.start();
            app.manage(voxd);
            if let Err(e) = dictation::register_shortcut(app.handle(), dictation::DEFAULT_SHORTCUT) {
                eprintln!("[dictation] {e}");
            }
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            voxd_state,
            voxd_logs,
            voxd_restart,
            client_log,
            dictation_toggle,
            dictation_insert,
            dictation_hide,
            dictation_set_shortcut,
            dictation_status,
            dictation_open_accessibility
        ])
        .build(tauri::generate_context!())
        .expect("error while building VoxStudio")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Voxd>().stop();
            }
        });
}
