mod config;
mod explorer_thumbnails;
mod lang;
mod launch;
mod library;
mod molang_inspector;
mod open_file;
mod popout;

use percent_encoding::percent_decode_str;
use tauri::Manager;

/// Writes the raw request body to the path chosen in the save dialog.
#[tauri::command]
async fn save_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
    return Err("缺少文件内容".into());
  };
  let path = request
    .headers()
    .get("path")
    .and_then(|value| value.to_str().ok())
    .ok_or("缺少保存路径")?;
  let path = percent_decode_str(path).decode_utf8().map_err(|error| error.to_string())?;
  std::fs::write(path.as_ref(), data).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Must be the first plugin: a second start exits here, before anything else
    // is set up, after handing its arguments to the running window (第 54 节).
    .plugin(tauri_plugin_single_instance::init(|app, args, cwd| open_file::second_instance(app, args, cwd)))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      // The main window is created here (not from the config) so that its
      // WebView2 browser arguments can follow the saved launch options.
      let options = launch::load();
      launch::manage(app, options);
      open_file::manage(app);
      launch::create_main_window(app, options)?;
      Ok(())
    })
    // The other windows (独立窗口, Molang 监视器) are not owned by the main
    // window, so closing the main window has to end the app itself.
    .on_window_event(|window, event| {
      if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        window.app_handle().exit(0);
      }
    })
    .invoke_handler(tauri::generate_handler![
      save_file,
      config::config_read,
      config::config_write,
      lang::language_files,
      lang::language_dir,
      launch::launch_options_state,
      launch::launch_options_set,
      launch::restart_app,
      library::library_state,
      library::library_import,
      library::library_upload,
      library::library_import_staged,
      library::library_set_info,
      library::library_add_game_dir,
      library::library_remove_game_dir,
      library::library_set_mounted,
      library::library_delete,
      library::library_rename,
      library::library_read_model,
      library::library_read_model_file,
      library::library_read_thumbnail,
      library::library_save_thumbnail,
      library::library_explorer_sync,
      explorer_thumbnails::library_explorer_status,
      explorer_thumbnails::library_explorer_scan,
      explorer_thumbnails::library_explorer_read,
      explorer_thumbnails::library_explorer_save,
      molang_inspector::molang_inspector_open,
      molang_inspector::molang_inspector_close,
      popout::popout_fit,
      popout::window_control,
      popout::window_pin,
      open_file::open_file_take,
      open_file::open_file_read
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
