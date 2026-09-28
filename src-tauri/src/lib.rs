//! VoxStudio desktop shell: window, glass effects, the voxd supervisor, dictation and tray.

mod dictation;
mod finder;
mod menu;
mod quick;
mod voxd;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
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
fn log_path(voxd: State<'_, Voxd>) -> Option<String> {
    voxd.log_path().map(|p| p.to_string_lossy().into_owned())
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

/// Forward `voxstudio://…` links to the UI, which decides what they do. Plain file paths (from
/// "Open With" on Windows/Linux, or a second launch) become a `voxstudio://files` link.
fn open_links(app: &AppHandle, urls: Vec<String>) {
    let mut links: Vec<String> = urls.iter().filter(|u| u.starts_with("voxstudio://")).cloned().collect();
    let files = finder::paths_in_args(&[String::new()].into_iter().chain(urls.iter().cloned()).collect::<Vec<_>>());
    links.extend(finder::files_link(&files, ""));
    if links.is_empty() {
        return;
    }
    show_main(app);
    app.state::<PendingLinks>().0.lock().unwrap().extend(links.iter().cloned());
    if let Some(w) = app.get_webview_window("main") {
        for link in links {
            let _ = w.emit("app://deep-link", link);
        }
    }
}

/// Links that arrived before the UI was listening (e.g. the app was launched by a link).
#[derive(Default)]
struct PendingLinks(std::sync::Mutex<Vec<String>>);

#[tauri::command]
fn quick_toggle(app: AppHandle) {
    quick::toggle(&app);
}

#[tauri::command]
fn quick_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(quick::QUICK) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quick_resize(app: AppHandle, height: f64) {
    quick::resize(&app, height);
}

#[tauri::command]
fn quick_set_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    quick::register_shortcut(&app, &accelerator)
}

#[tauri::command]
fn quick_set_selection_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    quick::register_selection_shortcut(&app, &accelerator)
}

#[tauri::command]
fn quick_take_pending(app: AppHandle) -> Option<quick::Pending> {
    quick::take_pending(&app)
}

#[tauri::command]
fn speak_selection(app: AppHandle) {
    quick::speak_selection(&app);
}

/// Hand a `voxstudio://` link to the main window (used by panels such as Quick Speak).
#[tauri::command]
fn open_link(app: AppHandle, url: String) {
    open_links(&app, vec![url]);
}

#[tauri::command]
fn finder_actions_status() -> bool {
    finder::installed()
}

#[tauri::command]
fn finder_actions_install() -> Result<Vec<String>, String> {
    finder::install()
}

#[tauri::command]
fn finder_actions_remove() -> Result<(), String> {
    finder::uninstall()
}

#[tauri::command]
fn take_pending_links(pending: State<'_, PendingLinks>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let dictate = MenuItemBuilder::with_id("dictate", "Start dictation").accelerator(dictation::DEFAULT_SHORTCUT).build(app)?;
    let speak = MenuItemBuilder::with_id("quick", "Quick Speak…").accelerator(quick::DEFAULT_SHORTCUT).build(app)?;
    let selection = MenuItemBuilder::with_id("selection", "Speak Selection").accelerator(quick::SELECTION_SHORTCUT).build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open VoxStudio").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit VoxStudio").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&dictate, &speak, &selection, &open, &PredefinedMenuItem::separator(app)?, &quit]).build()?;
    TrayIconBuilder::with_id("voxstudio")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip("VoxStudio")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dictate" => dictation::toggle(app),
            "quick" => quick::toggle(app),
            "selection" => quick::speak_selection(app),
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
        // Must come first: a second launch (or a link opened while running) goes to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app);
            open_links(app, argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(DictationState::default())
        .manage(PendingLinks::default())
        .manage(quick::QuickState::default())
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .setup(|app| {
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| open_links(&handle, event.urls().iter().map(|u| u.to_string()).collect()));
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    open_links(app.handle(), urls.iter().map(|u| u.to_string()).collect());
                }
                #[cfg(any(windows, target_os = "linux"))]
                let _ = app.deep_link().register_all();
                // Windows/Linux pass "Open with" files as arguments (macOS sends RunEvent::Opened).
                #[cfg(not(target_os = "macos"))]
                open_links(app.handle(), std::env::args().skip(1).collect());
            }
            let voxd = Voxd::new(app.handle().clone());
            voxd.start();
            app.manage(voxd);
            if let Err(e) = dictation::register_shortcut(app.handle(), dictation::DEFAULT_SHORTCUT) {
                eprintln!("[dictation] {e}");
            }
            if let Err(e) = quick::register_shortcut(app.handle(), quick::DEFAULT_SHORTCUT) {
                eprintln!("[quick] {e}");
            }
            if let Err(e) = quick::register_selection_shortcut(app.handle(), quick::SELECTION_SHORTCUT) {
                eprintln!("[quick] {e}");
            }
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            voxd_state,
            voxd_logs,
            voxd_restart,
            log_path,
            client_log,
            take_pending_links,
            finder_actions_status,
            finder_actions_install,
            finder_actions_remove,
            open_link,
            quick_toggle,
            quick_hide,
            quick_resize,
            quick_set_shortcut,
            quick_set_selection_shortcut,
            quick_take_pending,
            speak_selection,
            dictation_toggle,
            dictation_insert,
            dictation_hide,
            dictation_set_shortcut,
            dictation_status,
            dictation_open_accessibility
        ])
        .build(tauri::generate_context!())
        .expect("error while building VoxStudio")
        .run(|app, event| match event {
            RunEvent::Exit => app.state::<Voxd>().stop(),
            // Files opened with VoxStudio from Finder (Open With, the Dock icon, double-click).
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                // voxstudio:// links also arrive here, but the deep-link plugin already handles
                // them; only take the files, or every link would run twice.
                let paths: Vec<std::path::PathBuf> = urls.iter().filter(|u| u.scheme() == "file").filter_map(|u| u.to_file_path().ok()).collect();
                open_links(app, finder::files_link(&paths, "").into_iter().collect());
            }
            _ => {}
        });
}
