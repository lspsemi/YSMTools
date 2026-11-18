//! Model library: copies of imported model packs kept next to the executable,
//! their cover thumbnails, and links that mount them into the game's
//! `config/yes_steve_model/custom` folder.
//!
//! Layout under `<exe dir>/library`:
//! - `library.json`            game folders and model records
//! - `models/<id>/<file name>` the model pack (`.zip`, `.ysm` or a folder)
//! - `thumbnails/<id>.png`     cover rendered by the viewer
//! - `.staging/<batch>/`       files dropped on the library page, imported
//!   and then removed (the webview cannot hand over their paths)
//!
//! Each pack keeps its original file name so the link in the game folder has
//! the same name, and the game gives the model the same id as a plain copy.
//! Several game folders can be added; a model can be mounted in any of them.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::explorer_thumbnails;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
  #[serde(default)]
  game_dirs: Vec<GameDir>,
  #[serde(default)]
  models: Vec<ModelRecord>,
  /// The single game folder of libraries written before multiple folders;
  /// moved into `game_dirs` by `load`.
  #[serde(default, skip_serializing)]
  game_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GameDir {
  id: String,
  path: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModelRecord {
  id: String,
  name: String,
  file_name: String,
  is_dir: bool,
  size: u64,
  imported_at: u64,
  has_thumbnail: bool,
  #[serde(default)]
  links: Vec<MountLink>,
  /// The single link of libraries written before multiple game folders.
  #[serde(default, skip_serializing)]
  link: Option<MountLink>,
  /// Details read from the pack's ysm.json when the cover is rendered
  /// (authors, description, license...), stored as the page sends them.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  info: Option<serde_json::Value>,
  /// SHA-256 of a `.ysm` pack, the key of its Explorer thumbnail (section 70).
  /// Library copies never change, so it is computed once.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MountLink {
  /// Id of the game folder the link is in.
  #[serde(default)]
  dir: String,
  path: String,
  /// "symlink", "hardlink" or "junction".
  kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
  id: String,
  name: String,
  file_name: String,
  is_dir: bool,
  size: u64,
  imported_at: u64,
  has_thumbnail: bool,
  info: Option<serde_json::Value>,
  /// Game folders the model is mounted in.
  mounts: Vec<MountView>,
  /// Game folders that already hold a file or folder with the same name not
  /// made by the library.
  conflicts: Vec<String>,
}

#[derive(Serialize)]
pub struct MountView {
  dir: String,
  kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDirView {
  id: String,
  path: String,
  custom_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
  root: String,
  game_dirs: Vec<GameDirView>,
  models: Vec<ModelView>,
}

/// A failure of one model (and game folder) in a batch command.
#[derive(Serialize)]
pub struct ItemError {
  id: String,
  dir: Option<String>,
  message: String,
}

#[derive(Serialize)]
pub struct MountResult {
  models: Vec<ModelView>,
  errors: Vec<ItemError>,
}

#[derive(Serialize)]
pub struct DeleteResult {
  deleted: Vec<String>,
  errors: Vec<ItemError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
  added: Vec<ModelView>,
  skipped: Vec<Skipped>,
}

#[derive(Serialize)]
pub struct Skipped {
  path: String,
  reason: String,
}

fn root() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|error| error.to_string())?;
  Ok(exe.parent().ok_or("找不到程序目录")?.join("library"))
}

fn load(root: &Path) -> LibraryFile {
  let mut library: LibraryFile = fs::read(root.join("library.json"))
    .ok()
    .and_then(|data| serde_json::from_slice(&data).ok())
    .unwrap_or_default();
  // Older libraries: the single game folder becomes the first one ("g0").
  if let Some(path) = library.game_dir.take() {
    if library.game_dirs.is_empty() {
      library.game_dirs.push(GameDir { id: "g0".into(), path });
    }
  }
  let first = library.game_dirs.first().map(|dir| dir.id.clone()).unwrap_or_else(|| "g0".into());
  for record in &mut library.models {
    if let Some(mut link) = record.link.take() {
      if link.dir.is_empty() {
        link.dir = first.clone();
      }
      record.links.push(link);
    }
  }
  library
}

fn save(root: &Path, library: &LibraryFile) -> Result<(), String> {
  fs::create_dir_all(root).map_err(|error| error.to_string())?;
  let data = serde_json::to_vec_pretty(library).map_err(|error| error.to_string())?;
  let temp = root.join("library.json.tmp");
  fs::write(&temp, data).map_err(|error| error.to_string())?;
  fs::rename(&temp, root.join("library.json")).map_err(|error| error.to_string())
}

fn model_path(root: &Path, record: &ModelRecord) -> PathBuf {
  root.join("models").join(&record.id).join(&record.file_name)
}

/// The YSM custom model folder for a game folder chosen by the user. Accepts
/// the game (or version-isolated) folder, its `config` folder, or the
/// `custom` folder itself.
fn custom_dir(game_dir: &Path) -> Option<PathBuf> {
  let name = |path: &Path| path.file_name().map(|name| name.to_string_lossy().to_lowercase());
  if name(game_dir).as_deref() == Some("custom") && game_dir.parent().and_then(name).as_deref() == Some("yes_steve_model") {
    return Some(game_dir.to_path_buf());
  }
  if name(game_dir).as_deref() == Some("yes_steve_model") {
    return Some(game_dir.join("custom"));
  }
  if name(game_dir).as_deref() == Some("config") {
    return Some(game_dir.join("yes_steve_model").join("custom"));
  }
  if game_dir.join("config").is_dir() || game_dir.join("mods").is_dir() {
    return Some(game_dir.join("config").join("yes_steve_model").join("custom"));
  }
  None
}

fn link_exists(path: &Path) -> bool {
  fs::symlink_metadata(path).is_ok()
}

/// Whether `link` is still the link the library made to `target`, so that
/// removing it never deletes a file the user put there.
fn is_our_link(link: &MountLink, target: &Path) -> bool {
  let path = Path::new(&link.path);
  let Ok(meta) = fs::symlink_metadata(path) else { return false };
  match link.kind.as_str() {
    "symlink" | "junction" => meta.file_type().is_symlink() || is_reparse_point(&meta),
    // A hard link shares the file record, so it has the same size and time.
    "hardlink" => fs::metadata(target)
      .map(|original| original.len() == meta.len() && original.modified().ok() == meta.modified().ok())
      .unwrap_or(false),
    _ => false,
  }
}

#[cfg(windows)]
fn is_reparse_point(meta: &fs::Metadata) -> bool {
  use std::os::windows::fs::MetadataExt;
  meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse_point(_meta: &fs::Metadata) -> bool {
  false
}

/// A game folder with its custom folder and the (lower-case) names already
/// in it, read once per command so conflicts need no lookup per model.
struct ResolvedDir {
  id: String,
  path: String,
  custom: Option<PathBuf>,
  names: HashSet<String>,
}

fn resolve_dirs(library: &LibraryFile) -> Vec<ResolvedDir> {
  library
    .game_dirs
    .iter()
    .map(|dir| {
      let custom = custom_dir(Path::new(&dir.path));
      let names = custom
        .as_deref()
        .and_then(|custom| fs::read_dir(custom).ok())
        .map(|entries| entries.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().to_lowercase()).collect())
        .unwrap_or_default();
      ResolvedDir { id: dir.id.clone(), path: dir.path.clone(), custom, names }
    })
    .collect()
}

fn view(root: &Path, record: &ModelRecord, dirs: &[ResolvedDir]) -> ModelView {
  let target = model_path(root, record);
  let mounts: Vec<MountView> = record
    .links
    .iter()
    .filter(|link| dirs.iter().any(|dir| dir.id == link.dir) && is_our_link(link, &target))
    .map(|link| MountView { dir: link.dir.clone(), kind: link.kind.clone() })
    .collect();
  let file_name = record.file_name.to_lowercase();
  let conflicts = dirs
    .iter()
    .filter(|dir| !mounts.iter().any(|mount| mount.dir == dir.id) && dir.names.contains(&file_name))
    .map(|dir| dir.id.clone())
    .collect();
  ModelView {
    id: record.id.clone(),
    name: record.name.clone(),
    file_name: record.file_name.clone(),
    is_dir: record.is_dir,
    size: record.size,
    imported_at: record.imported_at,
    has_thumbnail: record.has_thumbnail,
    info: record.info.clone(),
    mounts,
    conflicts,
  }
}

fn state(root: &Path, library: &LibraryFile) -> LibraryState {
  let dirs = resolve_dirs(library);
  LibraryState {
    root: root.to_string_lossy().into_owned(),
    game_dirs: dirs
      .iter()
      .map(|dir| GameDirView { id: dir.id.clone(), path: dir.path.clone(), custom_dir: dir.custom.as_ref().map(|custom| custom.to_string_lossy().into_owned()) })
      .collect(),
    models: library.models.iter().map(|record| view(root, record, &dirs)).collect(),
  }
}

fn now() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)
}

fn is_model_folder(dir: &Path) -> bool {
  dir.join("ysm.json").is_file() || dir.join("models").join("main.json").is_file() || dir.join("main.json").is_file()
}

fn is_pack_file(path: &Path) -> bool {
  path.is_file()
    && path
      .extension()
      .map(|ext| matches!(ext.to_string_lossy().to_lowercase().as_str(), "zip" | "ysm"))
      .unwrap_or(false)
}

/// Model packs inside `path`: the path itself when it is a pack, otherwise
/// the packs and model folders below it (a few levels deep).
fn collect_packs(path: &Path, depth: u32, found: &mut Vec<PathBuf>) {
  if is_pack_file(path) || (path.is_dir() && is_model_folder(path)) {
    found.push(path.to_path_buf());
    return;
  }
  if depth == 0 || !path.is_dir() {
    return;
  }
  let Ok(entries) = fs::read_dir(path) else { return };
  let mut children: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect();
  children.sort();
  for child in children {
    collect_packs(&child, depth - 1, found);
  }
}

fn dir_size(path: &Path) -> u64 {
  fs::read_dir(path)
    .map(|entries| {
      entries
        .filter_map(Result::ok)
        .map(|entry| {
          let path = entry.path();
          if path.is_dir() { dir_size(&path) } else { entry.metadata().map(|meta| meta.len()).unwrap_or(0) }
        })
        .sum()
    })
    .unwrap_or(0)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
  fs::create_dir_all(to)?;
  for entry in fs::read_dir(from)? {
    let entry = entry?;
    let target = to.join(entry.file_name());
    if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &target)? } else { fs::copy(entry.path(), target).map(|_| ())? }
  }
  Ok(())
}

fn find<'a>(library: &'a mut LibraryFile, id: &str) -> Result<&'a mut ModelRecord, String> {
  library.models.iter_mut().find(|record| record.id == id).ok_or_else(|| "模型库中没有这个模型".into())
}

fn remove_link(link: &MountLink) -> Result<(), String> {
  let path = Path::new(&link.path);
  let result = if link.kind == "junction" || (link.kind == "symlink" && fs::metadata(path).map(|meta| meta.is_dir()).unwrap_or(false)) {
    // Removes only the link; the folder it points to stays in the library.
    fs::remove_dir(path)
  } else {
    fs::remove_file(path)
  };
  result.map_err(|error| format!("无法移除链接：{error}"))
}

#[cfg(windows)]
fn create_link(target: &Path, link: &Path, is_dir: bool) -> Result<&'static str, String> {
  use std::os::windows::fs::{symlink_dir, symlink_file};
  if is_dir {
    if symlink_dir(target, link).is_ok() {
      return Ok("symlink");
    }
    // Directory junctions need no Developer Mode or administrator rights.
    use std::os::windows::process::CommandExt;
    let status = std::process::Command::new("cmd")
      .args(["/C", "mklink", "/J"])
      .arg(link)
      .arg(target)
      .creation_flags(0x0800_0000)
      .output()
      .map_err(|error| error.to_string())?;
    return if status.status.success() { Ok("junction") } else { Err("无法创建目录联接".into()) };
  }
  if symlink_file(target, link).is_ok() {
    return Ok("symlink");
  }
  // Symbolic links to files need Developer Mode or administrator rights;
  // a hard link works without them when both folders are on one drive.
  fs::hard_link(target, link).map(|_| "hardlink").map_err(|_| {
    "无法创建符号链接：请在 Windows 设置 → 系统 → 开发者选项中开启“开发人员模式”，或把游戏和本程序放在同一个磁盘分区".to_string()
  })
}

#[cfg(not(windows))]
fn create_link(target: &Path, link: &Path, _is_dir: bool) -> Result<&'static str, String> {
  std::os::unix::fs::symlink(target, link).map(|_| "symlink").map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_state() -> Result<LibraryState, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  Ok(state(&root, &load(&root)))
}

#[tauri::command]
pub async fn library_import(paths: Vec<String>) -> Result<ImportResult, String> {
  let _guard = LOCK.lock().unwrap();
  import_paths(&root()?, &paths)
}

fn staging_dir(root: &Path, batch: &str) -> Result<PathBuf, String> {
  let batch: String = batch.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
  if batch.is_empty() {
    return Err("无效的批次".into());
  }
  Ok(root.join(".staging").join(batch))
}

/// Writes one dropped file (raw request body) to `.staging/<batch>/<path>`;
/// `batch` and the URL-encoded relative `path` come in the headers.
#[tauri::command]
pub async fn library_upload(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
    return Err("缺少文件内容".into());
  };
  let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_string);
  let batch = header("batch").ok_or("缺少批次")?;
  let relative = header("path").ok_or("缺少路径")?;
  let relative = percent_encoding::percent_decode_str(&relative).decode_utf8().map_err(|error| error.to_string())?.into_owned();
  if relative.is_empty() || relative.split(['/', '\\']).any(|part| part == ".." || part.contains(':')) {
    return Err("无效的路径".into());
  }
  let file = staging_dir(&root()?, &batch)?.join(relative);
  fs::create_dir_all(file.parent().unwrap()).map_err(|error| error.to_string())?;
  fs::write(file, data).map_err(|error| error.to_string())
}

/// Imports everything uploaded under `.staging/<batch>`, then removes it.
#[tauri::command]
pub async fn library_import_staged(batch: String) -> Result<ImportResult, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let dir = staging_dir(&root, &batch)?;
  let paths: Vec<String> = fs::read_dir(&dir)
    .map(|entries| entries.filter_map(Result::ok).map(|entry| entry.path().to_string_lossy().into_owned()).collect())
    .unwrap_or_default();
  let result = import_paths(&root, &paths);
  let _ = fs::remove_dir_all(&dir);
  result
}

#[tauri::command]
pub async fn library_set_info(id: String, info: serde_json::Value) -> Result<(), String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  find(&mut library, &id)?.info = Some(info);
  save(&root, &library)
}

fn import_paths(root: &Path, paths: &[String]) -> Result<ImportResult, String> {
  let root = root.to_path_buf();
  let mut library = load(&root);
  let mut packs = Vec::new();
  for path in paths {
    collect_packs(Path::new(path), 3, &mut packs);
  }
  let (mut added, mut skipped) = (Vec::new(), Vec::new());
  let dirs = resolve_dirs(&library);
  for (index, pack) in packs.iter().enumerate() {
    let file_name = pack.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let is_dir = pack.is_dir();
    let size = if is_dir { dir_size(pack) } else { fs::metadata(pack).map(|meta| meta.len()).unwrap_or(0) };
    if library.models.iter().any(|record| record.file_name == file_name && record.size == size) {
      skipped.push(Skipped { path: pack.to_string_lossy().into_owned(), reason: "已在模型库中".into() });
      continue;
    }
    let id = format!("{:x}{:02x}", now(), index % 256);
    let record = ModelRecord {
      id: id.clone(),
      name: Path::new(&file_name).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or(file_name.clone()),
      file_name: file_name.clone(),
      is_dir,
      size,
      imported_at: now(),
      has_thumbnail: false,
      sha256: None,
      links: Vec::new(),
      link: None,
      info: None,
    };
    let target = model_path(&root, &record);
    let copied = fs::create_dir_all(target.parent().unwrap()).and_then(|_| if is_dir { copy_dir(pack, &target) } else { fs::copy(pack, &target).map(|_| ()) });
    if let Err(error) = copied {
      let _ = fs::remove_dir_all(root.join("models").join(&id));
      skipped.push(Skipped { path: pack.to_string_lossy().into_owned(), reason: format!("复制失败：{error}") });
      continue;
    }
    added.push(view(&root, &record, &dirs));
    library.models.push(record);
  }
  save(&root, &library)?;
  Ok(ImportResult { added, skipped })
}

#[tauri::command]
pub async fn library_add_game_dir(path: String) -> Result<LibraryState, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  let custom = custom_dir(Path::new(&path)).ok_or("这里没有找到 config 或 mods 文件夹。请选择游戏目录（开启版本隔离时为 versions/<版本名>），或直接选择 config/yes_steve_model/custom 文件夹")?;
  let key = custom.to_string_lossy().to_lowercase();
  if library.game_dirs.iter().any(|dir| custom_dir(Path::new(&dir.path)).is_some_and(|other| other.to_string_lossy().to_lowercase() == key)) {
    return Err("这个游戏目录已经添加过了".into());
  }
  fs::create_dir_all(&custom).map_err(|error| format!("无法创建 {}：{error}", custom.display()))?;
  library.game_dirs.push(GameDir { id: format!("{:x}{:04x}", now(), library.game_dirs.len() % 0x10000), path });
  save(&root, &library)?;
  Ok(state(&root, &library))
}

/// Removes the links the library made in that game folder, then forgets it.
#[tauri::command]
pub async fn library_remove_game_dir(id: String) -> Result<LibraryState, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  for record in &mut library.models {
    let target = model_path(&root, record);
    for link in record.links.iter().filter(|link| link.dir == id) {
      if is_our_link(link, &target) {
        remove_link(link)?;
      }
    }
    record.links.retain(|link| link.dir != id);
  }
  library.game_dirs.retain(|dir| dir.id != id);
  save(&root, &library)?;
  Ok(state(&root, &library))
}

/// Mounts or unmounts several models in several game folders. Unmounting with
/// no folders given removes every link of the models. Failures are reported
/// per model and folder; everything else still goes through.
#[tauri::command]
pub async fn library_set_mounted(ids: Vec<String>, dirs: Vec<String>, mounted: bool) -> Result<MountResult, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  let all = resolve_dirs(&library);
  let targets: Vec<&ResolvedDir> = all.iter().filter(|dir| dirs.contains(&dir.id)).collect();
  if mounted && targets.is_empty() {
    return Err("请先添加游戏目录".into());
  }
  let (mut errors, mut changed) = (Vec::new(), Vec::new());
  for id in &ids {
    let Some(record) = library.models.iter_mut().find(|record| &record.id == id) else {
      errors.push(ItemError { id: id.clone(), dir: None, message: "模型库中没有这个模型".into() });
      continue;
    };
    let target = model_path(&root, record);
    if mounted {
      for dir in &targets {
        if record.links.iter().any(|link| link.dir == dir.id && is_our_link(link, &target)) {
          continue;
        }
        let result = (|| {
          let custom = dir.custom.as_ref().ok_or_else(|| "游戏目录无效".to_string())?;
          let link = custom.join(&record.file_name);
          if link_exists(&link) {
            return Err(format!("已有同名的 {}，请先移走它", record.file_name));
          }
          fs::create_dir_all(custom).map_err(|error| error.to_string())?;
          let kind = create_link(&target, &link, record.is_dir)?;
          Ok(MountLink { dir: dir.id.clone(), path: link.to_string_lossy().into_owned(), kind: kind.into() })
        })();
        match result {
          Ok(link) => {
            record.links.retain(|item| item.dir != dir.id);
            record.links.push(link);
          }
          Err(message) => errors.push(ItemError { id: id.clone(), dir: Some(dir.id.clone()), message }),
        }
      }
    } else {
      let mut kept = Vec::new();
      for link in record.links.drain(..) {
        if !dirs.is_empty() && !dirs.contains(&link.dir) {
          kept.push(link);
          continue;
        }
        if is_our_link(&link, &target) {
          if let Err(message) = remove_link(&link) {
            errors.push(ItemError { id: id.clone(), dir: Some(link.dir.clone()), message });
            kept.push(link);
          }
        }
      }
      record.links = kept;
    }
    changed.push(id.clone());
  }
  save(&root, &library)?;
  let fresh = resolve_dirs(&library);
  let models = library.models.iter().filter(|record| changed.contains(&record.id)).map(|record| view(&root, record, &fresh)).collect();
  Ok(MountResult { models, errors })
}

#[tauri::command]
pub async fn library_delete(ids: Vec<String>) -> Result<DeleteResult, String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  let (mut deleted, mut errors) = (Vec::new(), Vec::new());
  for id in &ids {
    let Some(record) = library.models.iter().find(|record| &record.id == id) else {
      errors.push(ItemError { id: id.clone(), dir: None, message: "模型库中没有这个模型".into() });
      continue;
    };
    let target = model_path(&root, record);
    let result = (|| {
      for link in &record.links {
        if is_our_link(link, &target) {
          remove_link(link)?;
        }
      }
      fs::remove_dir_all(root.join("models").join(&record.id)).or_else(|error| if error.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(error.to_string()) })?;
      let _ = fs::remove_file(root.join("thumbnails").join(format!("{}.png", record.id)));
      Ok::<(), String>(())
    })();
    match result {
      Ok(()) => deleted.push(id.clone()),
      Err(message) => errors.push(ItemError { id: id.clone(), dir: None, message }),
    }
  }
  library.models.retain(|model| !deleted.contains(&model.id));
  save(&root, &library)?;
  Ok(DeleteResult { deleted, errors })
}

#[tauri::command]
pub async fn library_rename(id: String, name: String) -> Result<(), String> {
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  find(&mut library, &id)?.name = name;
  save(&root, &library)
}

/// The pack's bytes for `.zip`/`.ysm` models, or the relative file list
/// (JSON) for folder models.
#[tauri::command]
pub async fn library_read_model(id: String) -> Result<tauri::ipc::Response, String> {
  let root = root()?;
  let record = { let _guard = LOCK.lock().unwrap(); find(&mut load(&root), &id)?.clone() };
  let path = model_path(&root, &record);
  if !record.is_dir {
    return fs::read(path).map(tauri::ipc::Response::new).map_err(|error| error.to_string());
  }
  fn walk(base: &Path, dir: &Path, files: &mut Vec<String>) {
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
      let path = entry.path();
      if path.is_dir() { walk(base, &path, files) } else if let Ok(relative) = path.strip_prefix(base) { files.push(relative.to_string_lossy().replace('\\', "/")) }
    }
  }
  let mut files = Vec::new();
  walk(&path, &path, &mut files);
  Ok(tauri::ipc::Response::new(serde_json::to_vec(&files).map_err(|error| error.to_string())?))
}

#[tauri::command]
pub async fn library_read_model_file(id: String, path: String) -> Result<tauri::ipc::Response, String> {
  let root = root()?;
  let record = { let _guard = LOCK.lock().unwrap(); find(&mut load(&root), &id)?.clone() };
  if path.split(['/', '\\']).any(|part| part == ".." || part.contains(':')) {
    return Err("无效的路径".into());
  }
  fs::read(model_path(&root, &record).join(path)).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_read_thumbnail(id: String) -> Result<tauri::ipc::Response, String> {
  if id.contains(['/', '\\', '.']) {
    return Err("无效的模型".into());
  }
  fs::read(root()?.join("thumbnails").join(format!("{id}.png"))).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}

/// Stores the PNG in the request body as the cover of the model named in the
/// `id` header.
#[tauri::command]
pub async fn library_save_thumbnail(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
    return Err("缺少图片内容".into());
  };
  let id = request.headers().get("id").and_then(|value| value.to_str().ok()).ok_or("缺少模型 id")?.to_string();
  let _guard = LOCK.lock().unwrap();
  let root = root()?;
  let mut library = load(&root);
  let record = find(&mut library, &id)?;
  let folder = root.join("thumbnails");
  fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
  fs::write(folder.join(format!("{id}.png")), data).map_err(|error| error.to_string())?;
  record.has_thumbnail = true;
  let explorer = explorer_cover(&root, record);
  save(&root, &library)?;
  // The Explorer thumbnail is extra; a failure does not fail the cover.
  if let Some((hash, paths)) = explorer {
    if let Err(error) = explorer_thumbnails::store(&hash, data, paths) {
      eprintln!("explorer thumbnail: {error}");
    }
  }
  Ok(())
}

/// For a `.ysm` pack: its hash (stored in the record) and the files Explorer
/// shows it as (the library copy and the game links), section 70.
fn explorer_cover(root: &Path, record: &mut ModelRecord) -> Option<(String, Vec<PathBuf>)> {
  if record.is_dir || !explorer_thumbnails::is_ysm(Path::new(&record.file_name)) {
    return None;
  }
  let file = model_path(root, record);
  if record.sha256.is_none() {
    record.sha256 = explorer_thumbnails::hash_file(&file).ok();
  }
  let hash = record.sha256.clone()?;
  let mut paths = vec![file.clone()];
  paths.extend(record.links.iter().filter(|link| is_our_link(link, &file)).map(|link| PathBuf::from(&link.path)));
  Some((hash, paths))
}

/// Gives the Explorer thumbnail cache the covers of library `.ysm` packs that
/// do not have one there yet (covers made before section 70, or a cleared
/// cache). Resolves to the number of covers added.
#[tauri::command]
pub async fn library_explorer_sync() -> Result<usize, String> {
  let root = root()?;
  // Hash outside the lock: the first run reads every pack once.
  let pending: Vec<(String, PathBuf)> = {
    let _guard = LOCK.lock().unwrap();
    load(&root)
      .models
      .iter()
      .filter(|record| record.has_thumbnail && record.sha256.is_none() && !record.is_dir && explorer_thumbnails::is_ysm(Path::new(&record.file_name)))
      .map(|record| (record.id.clone(), model_path(&root, record)))
      .collect()
  };
  let hashes: Vec<(String, String)> = pending.into_iter().filter_map(|(id, file)| explorer_thumbnails::hash_file(&file).ok().map(|hash| (id, hash))).collect();
  let _guard = LOCK.lock().unwrap();
  let mut library = load(&root);
  for (id, hash) in hashes {
    if let Some(record) = library.models.iter_mut().find(|record| record.id == id) {
      record.sha256 = Some(hash);
    }
  }
  let mut added = 0;
  for record in &mut library.models {
    if !record.has_thumbnail {
      continue;
    }
    let Some((hash, paths)) = explorer_cover(&root, record) else { continue };
    if explorer_thumbnails::has_cover(&hash) {
      continue;
    }
    let Ok(png) = fs::read(root.join("thumbnails").join(format!("{}.png", record.id))) else { continue };
    if explorer_thumbnails::store(&hash, &png, paths).is_ok() {
      added += 1;
    }
  }
  save(&root, &library)?;
  Ok(added)
}
