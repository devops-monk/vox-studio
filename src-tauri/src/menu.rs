//! Native menu bar. Items that belong to the UI (navigation, panels, updates) are forwarded to the
//! main window as `app://menu` events carrying the item id; the rest are standard OS items.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

const DOCS: &str = "https://vox-studio.devops-monk.com/docs/";
const API_DOCS: &str = "https://vox-studio.devops-monk.com/docs/api/overview.html";
const SITE: &str = "https://vox-studio.devops-monk.com";

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let about = AboutMetadataBuilder::new()
        .name(Some("VoxStudio"))
        .version(Some(app.package_info().version.to_string()))
        .website(Some(SITE))
        .license(Some("Apache-2.0"))
        .build();

    let app_menu = SubmenuBuilder::new(app, "VoxStudio")
        .item(&PredefinedMenuItem::about(app, Some("About VoxStudio"), Some(about))?)
        .item(&item("updates", "Check for Updates…", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-script", "New Script", Some("CmdOrCtrl+N"))?)
        .item(&item("clone-voice", "Clone a Voice…", None)?)
        .separator()
        .item(&item("transcribe-file", "Transcribe a File…", None)?)
        .item(&item("dub-video", "Dub a Video…", None)?)
        .item(&item("import-book", "Import a Book…", None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Without these, ⌘C/⌘V/⌘Z don't reach text fields in the webview on macOS.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("palette", "Search…", None)?)
        .item(&item("inspector", "Show Recent Takes", Some("CmdOrCtrl+Alt+I"))?)
        .item(&item("activity", "Show Activity", None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&item("go:/", "Home", Some("CmdOrCtrl+Shift+H"))?)
        .item(&item("go:/history", "History", None)?)
        .item(&item("go:/voices", "Voices", None)?)
        .item(&item("go:/projects", "Projects", None)?)
        .item(&item("go:/models", "Models", None)?)
        .item(&item("go:/tools", "Tools", None)?)
        .item(&item("go:/integrations", "Integrations", None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&item("main-window", "VoxStudio", None)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "VoxStudio Help", None)?)
        .item(&item("api-docs", "API Reference", None)?)
        .item(&item("website", "VoxStudio Website", None)?)
        .build()?;

    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &go, &window, &help]).build()
}

pub fn handle(app: &AppHandle, id: &str) {
    let url = match id {
        "help" => Some(DOCS),
        "api-docs" => Some(API_DOCS),
        "website" => Some(SITE),
        _ => None,
    };
    if let Some(url) = url {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(url, None::<&str>);
        return;
    }
    crate::show_main(app);
    if id != "main-window" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("app://menu", id);
        }
    }
}
