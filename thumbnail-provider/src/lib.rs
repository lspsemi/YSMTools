//! Windows Explorer thumbnail provider for `.ysm` models (docs/maintenance
//! section 70).
//!
//! The DLL does not render models: the cover renderer runs in the app's
//! WebGL viewer. The app stores each rendered cover as
//! `%LOCALAPPDATA%\com.ysm.preview\explorer-thumbnails\<sha256 of the file>.png`
//! and this provider hashes the stream Explorer hands it and returns that
//! PNG. Keying by content (not path) makes copies, links and moved files
//! show the same cover. A file without a cover fails, so Explorer falls back
//! to the .ysm file icon.
//!
//! The handler is registered per user (HKCU) with DisableProcessIsolation=1:
//! Explorer's isolated thumbnail surrogate does not activate HKCU-registered
//! classes (REGDB_E_CLASSNOTREG), so it runs inside the shell's process. It
//! must therefore never crash or hang its host: panics are caught (the crate
//! builds with panic=unwind), covers larger than MAX_PIXELS are refused.

#![allow(non_snake_case)]

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};

use sha2::{Digest, Sha256};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, E_UNEXPECTED, S_FALSE, S_OK};
use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::System::Com::{CoTaskMemFree, IClassFactory, IClassFactory_Impl, IStream};
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{FOLDERID_LocalAppData, IThumbnailProvider, IThumbnailProvider_Impl, SHGetKnownFolderPath, KF_FLAG_DEFAULT, WTSAT_ARGB, WTS_ALPHATYPE};
use windows_core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT};

/// CLSID of the provider. The installer (src-tauri/windows/installer-hooks.nsh)
/// and tools/explorer-thumbnail-register.ps1 register the same value.
pub const CLSID_YSM_THUMBNAIL: GUID = GUID::from_u128(0xF6A5A6A3_58D9_4762_82C8_B325D784819C);

/// Cache folder under %LOCALAPPDATA%, shared with the app (the Tauri
/// identifier) and the dev server.
const CACHE_DIR: &[&str] = &["com.ysm.preview", "explorer-thumbnails"];

/// Covers are 400×600; anything far larger is not ours.
const MAX_PIXELS: u64 = 4096 * 4096;

/// LockServer count plus live providers; the DLL may unload only at zero.
static LOCKS: AtomicI32 = AtomicI32::new(0);

fn cache_dir() -> Option<PathBuf> {
  // SAFETY: the returned buffer is freed with CoTaskMemFree once copied.
  let base = unsafe {
    let raw = SHGetKnownFolderPath(&FOLDERID_LocalAppData, KF_FLAG_DEFAULT, None).ok()?;
    let path = raw.to_string().ok();
    CoTaskMemFree(Some(raw.0 as *const c_void));
    path?
  };
  Some(CACHE_DIR.iter().fold(PathBuf::from(base), |path, part| path.join(part)))
}

/// SHA-256 of the whole stream, lower-case hex.
fn hash_stream(stream: &IStream) -> windows_core::Result<String> {
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 1 << 16];
  loop {
    let mut read = 0u32;
    // SAFETY: buffer outlives the call and its length is passed.
    let result = unsafe { stream.Read(buffer.as_mut_ptr().cast(), buffer.len() as u32, Some(&mut read)) };
    result.ok()?;
    hasher.update(&buffer[..read as usize]);
    if read == 0 || result == S_FALSE {
      break;
    }
  }
  Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Decodes a PNG to straight-alpha RGBA.
fn decode_png(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
  let mut decoder = png::Decoder::new(bytes);
  decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
  let mut reader = decoder.read_info().ok()?;
  let header = reader.info();
  if header.width == 0 || header.height == 0 || header.width as u64 * header.height as u64 > MAX_PIXELS {
    return None;
  }
  let mut data = vec![0; reader.output_buffer_size()];
  let info = reader.next_frame(&mut data).ok()?;
  let (width, height) = (info.width, info.height);
  data.truncate(info.buffer_size());
  let rgba = match info.color_type {
    png::ColorType::Rgba => data,
    png::ColorType::Rgb => data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
    png::ColorType::GrayscaleAlpha => data.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
    png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
    png::ColorType::Indexed => return None,
  };
  Some((width, height, rgba))
}

/// Box-filter downscale so the longer side is at most `limit` (never
/// upscales). Averages premultiplied colour so transparent pixels do not
/// darken edges, then returns straight-alpha BGRA rows, top-down.
fn fit_bgra(width: u32, height: u32, rgba: &[u8], limit: u32) -> (u32, u32, Vec<u8>) {
  let scale = (limit as f64 / width.max(height) as f64).min(1.0);
  let out_w = ((width as f64 * scale).round() as u32).max(1);
  let out_h = ((height as f64 * scale).round() as u32).max(1);
  let mut out = vec![0u8; (out_w * out_h * 4) as usize];
  for y in 0..out_h {
    let y0 = y * height / out_h;
    let y1 = ((y + 1) * height / out_h).max(y0 + 1);
    for x in 0..out_w {
      let x0 = x * width / out_w;
      let x1 = ((x + 1) * width / out_w).max(x0 + 1);
      let (mut r, mut g, mut b, mut a, mut n) = (0f64, 0f64, 0f64, 0f64, 0f64);
      for sy in y0..y1 {
        for sx in x0..x1 {
          let i = ((sy * width + sx) * 4) as usize;
          let alpha = rgba[i + 3] as f64;
          r += rgba[i] as f64 * alpha;
          g += rgba[i + 1] as f64 * alpha;
          b += rgba[i + 2] as f64 * alpha;
          a += alpha;
          n += 1.0;
        }
      }
      let o = ((y * out_w + x) * 4) as usize;
      if a > 0.0 {
        out[o] = (b / a).round() as u8;
        out[o + 1] = (g / a).round() as u8;
        out[o + 2] = (r / a).round() as u8;
        out[o + 3] = (a / n).round() as u8;
      }
    }
  }
  (out_w, out_h, out)
}

fn make_bitmap(width: u32, height: u32, bgra: &[u8]) -> windows_core::Result<HBITMAP> {
  let info = BITMAPINFO {
    bmiHeader: BITMAPINFOHEADER {
      biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
      biWidth: width as i32,
      biHeight: -(height as i32), // top-down rows
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB.0,
      ..Default::default()
    },
    ..Default::default()
  };
  let mut bits: *mut c_void = std::ptr::null_mut();
  // SAFETY: the section is width*height*4 bytes, exactly bgra.len().
  unsafe {
    let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
    if bits.is_null() {
      return Err(E_FAIL.into());
    }
    std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), bgra.len());
    Ok(bitmap)
  }
}

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct Provider {
  stream: RefCell<Option<IStream>>,
}

impl Provider {
  fn new() -> Self {
    LOCKS.fetch_add(1, Ordering::SeqCst);
    Provider { stream: RefCell::new(None) }
  }
}

impl Drop for Provider {
  fn drop(&mut self) {
    LOCKS.fetch_sub(1, Ordering::SeqCst);
  }
}

impl IInitializeWithStream_Impl for Provider_Impl {
  fn Initialize(&self, stream: Ref<'_, IStream>, _mode: u32) -> windows_core::Result<()> {
    let stream = stream.ok()?.clone();
    let mut slot = self.stream.borrow_mut();
    if slot.is_some() {
      return Err(E_UNEXPECTED.into());
    }
    *slot = Some(stream);
    Ok(())
  }
}

impl IThumbnailProvider_Impl for Provider_Impl {
  fn GetThumbnail(&self, cx: u32, bitmap: *mut HBITMAP, alpha: *mut WTS_ALPHATYPE) -> windows_core::Result<()> {
    if bitmap.is_null() || alpha.is_null() {
      return Err(E_POINTER.into());
    }
    let stream = self.stream.borrow_mut().take().ok_or(windows_core::Error::from(E_UNEXPECTED))?;
    // Runs inside Explorer: a panic must become an error, never unwind into
    // or abort the host.
    let handle = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| thumbnail(&stream, cx))).unwrap_or_else(|_| Err(E_FAIL.into()))?;
    // SAFETY: both pointers were checked above.
    unsafe {
      *bitmap = handle;
      *alpha = WTSAT_ARGB;
    }
    Ok(())
  }
}

/// Looks up the cover of the streamed file and scales it to fit `cx`.
fn thumbnail(stream: &IStream, cx: u32) -> windows_core::Result<HBITMAP> {
  let hash = hash_stream(stream)?;
  let file = cache_dir().ok_or(windows_core::Error::from(E_FAIL))?.join(format!("{hash}.png"));
  let bytes = std::fs::read(file).map_err(|_| windows_core::Error::from(E_FAIL))?;
  let (width, height, rgba) = decode_png(&bytes).ok_or(windows_core::Error::from(E_FAIL))?;
  let (out_w, out_h, bgra) = fit_bgra(width, height, &rgba, cx.clamp(1, 2048));
  make_bitmap(out_w, out_h, &bgra)
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
  fn CreateInstance(&self, outer: Ref<'_, IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> windows_core::Result<()> {
    if object.is_null() || iid.is_null() {
      return Err(E_POINTER.into());
    }
    // SAFETY: checked non-null above.
    unsafe { *object = std::ptr::null_mut() };
    if outer.is_some() {
      return Err(CLASS_E_NOAGGREGATION.into());
    }
    let provider: IUnknown = Provider::new().into();
    // SAFETY: iid and object are valid out-parameters from the caller.
    unsafe { provider.query(iid, object).ok() }
  }

  fn LockServer(&self, lock: BOOL) -> windows_core::Result<()> {
    if lock.as_bool() {
      LOCKS.fetch_add(1, Ordering::SeqCst);
    } else {
      LOCKS.fetch_sub(1, Ordering::SeqCst);
    }
    Ok(())
  }
}

/// COM entry point: hands out the class factory of the provider.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
  if clsid.is_null() || iid.is_null() || object.is_null() {
    return E_POINTER;
  }
  *object = std::ptr::null_mut();
  if *clsid != CLSID_YSM_THUMBNAIL {
    return CLASS_E_CLASSNOTAVAILABLE;
  }
  let factory: IClassFactory = Factory.into();
  factory.query(iid, object)
}

/// COM entry point: the DLL may unload once no provider is alive or locked.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
  if LOCKS.load(Ordering::SeqCst) > 0 {
    S_FALSE
  } else {
    S_OK
  }
}
