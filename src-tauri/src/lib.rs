//! VoxStudio desktop shell: window, glass effects and the voxd supervisor.

mod voxd;

use tauri::{Manager, RunEvent, State};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let voxd = Voxd::new(app.handle().clone());
            voxd.start();
            app.manage(voxd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![voxd_state, voxd_logs, voxd_restart])
        .build(tauri::generate_context!())
        .expect("error while building VoxStudio")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Voxd>().stop();
            }
        });
}
