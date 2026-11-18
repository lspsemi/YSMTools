//! Asks the Windows shell for a file's thumbnail, the same way Explorer does
//! (thumbnail cache + isolated handler process), and saves it as PNG.
//! Usage: cargo run --release --example probe -- <file> <out.png> [size]
//!        cargo run --release --example probe -- --refresh <size> <file>...
//! --refresh re-extracts the files into the thumbnail cache at that size
//! (WTS_FORCEEXTRACTION), the way the app refreshes covers it changed.
//! Exit code 0 = a real thumbnail came back, 2 = none (the shell had only the
//! icon), 1 = error. Used to verify the provider (docs section 70).

use std::ffi::c_void;

use windows::core::HSTRING;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{IShellItem, IShellItemImageFactory, IThumbnailCache, LocalThumbnailCache, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY, WTS_FORCEEXTRACTION};

fn refresh(size: u32, files: &[String]) {
  unsafe {
    let cache: IThumbnailCache = CoCreateInstance(&LocalThumbnailCache, None, CLSCTX_INPROC_SERVER).expect("thumbnail cache");
    for file in files {
      let item: IShellItem = match SHCreateItemFromParsingName(&HSTRING::from(file.as_str()), None) {
        Ok(item) => item,
        Err(error) => {
          println!("{file}: {error}");
          continue;
        }
      };
      match cache.GetThumbnail(&item, size, WTS_FORCEEXTRACTION, None, None, None) {
        Ok(()) => println!("{file}: refreshed"),
        Err(error) => println!("{file}: {error}"),
      }
    }
  }
}

fn main() {
  let args: Vec<String> = std::env::args().collect();
  if args.get(1).map(String::as_str) == Some("--refresh") {
    unsafe {
      let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    refresh(args.get(2).and_then(|value| value.parse().ok()).unwrap_or(256), &args[3.min(args.len())..]);
    return;
  }
  if args.len() < 3 {
    eprintln!("usage: probe <file> <out.png> [size]");
    std::process::exit(1);
  }
  let size: i32 = args.get(3).and_then(|value| value.parse().ok()).unwrap_or(256);
  unsafe {
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let item: IShellItemImageFactory = match SHCreateItemFromParsingName(&HSTRING::from(args[1].as_str()), None) {
      Ok(item) => item,
      Err(error) => {
        eprintln!("cannot open item: {error}");
        std::process::exit(1);
      }
    };
    let bitmap = match item.GetImage(SIZE { cx: size, cy: size }, SIIGBF_THUMBNAILONLY) {
      Ok(bitmap) => bitmap,
      Err(error) => {
        println!("no thumbnail: {error}");
        std::process::exit(2);
      }
    };
    let mut info = BITMAP::default();
    GetObjectW(bitmap.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut info as *mut BITMAP as *mut c_void));
    let (width, height) = (info.bmWidth, info.bmHeight.abs());
    let mut header = BITMAPINFO {
      bmiHeader: BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
      },
      ..Default::default()
    };
    let mut bgra = vec![0u8; (width * height * 4) as usize];
    let dc = GetDC(None);
    GetDIBits(dc, bitmap, 0, height as u32, Some(bgra.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
    ReleaseDC(None, dc);
    let _ = DeleteObject(bitmap.into());
    let rgba: Vec<u8> = bgra.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
    let file = std::fs::File::create(&args[2]).expect("cannot write output");
    let mut encoder = png::Encoder::new(file, width as u32, height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.write_header().unwrap().write_image_data(&rgba).unwrap();
    println!("thumbnail {width}x{height} -> {}", args[2]);
  }
}
