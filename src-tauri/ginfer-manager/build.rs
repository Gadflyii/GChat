use std::{io::Cursor, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../icons/icon.png");
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=../../web-app/public/fonts/geist");
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // ICO entries cannot use the shared 512px brand frame.
        let source = std::fs::read("../icons/icon.png").expect("shared brand icon");
        let mut reader = png::Decoder::new(Cursor::new(source))
            .read_info()
            .expect("brand PNG");
        let mut pixels = vec![0; reader.output_buffer_size().expect("PNG size")];
        let info = reader.next_frame(&mut pixels).expect("brand pixels");
        assert_eq!(
            (info.width, info.height, info.color_type),
            (512, 512, png::ColorType::Rgba)
        );
        let mut reduced = vec![0u8; 256 * 256 * 4];
        for y in 0..256 {
            for x in 0..256 {
                for channel in 0..4 {
                    let sum: u16 = (0..2)
                        .flat_map(|dy| (0..2).map(move |dx| (dy, dx)))
                        .map(|(dy, dx)| {
                            pixels[((y * 2 + dy) * 512 + x * 2 + dx) * 4 + channel] as u16
                        })
                        .sum();
                    reduced[(y * 256 + x) * 4 + channel] = ((sum + 2) / 4) as u8;
                }
            }
        }
        let mut frame = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut frame, 256, 256);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .expect("ICO PNG header")
                .write_image_data(&reduced)
                .expect("ICO PNG pixels");
        }
        let mut icon = vec![0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0];
        icon.extend((frame.len() as u32).to_le_bytes());
        icon.extend(22u32.to_le_bytes());
        icon.extend(frame);
        let path = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR")).join("manager.ico");
        std::fs::write(&path, icon).expect("generated Windows icon");
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(path));
    }
    tauri_build::try_build(attributes).expect("Manager Tauri build");
}
