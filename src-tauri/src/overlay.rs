use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, Position, Window};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarBoundsDto {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub position: String,
}

#[tauri::command]
pub async fn overlay_set_ignore_cursor_events<R: tauri::Runtime>(
    window: Window<R>,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| format!("Falha ao alterar passthrough do mouse: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn overlay_set_always_on_top<R: tauri::Runtime>(
    window: Window<R>,
    always_on_top: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("Falha ao alterar modo AlwaysOnTop: {error}"))?;

    Ok(())
}

#[tauri::command]
pub async fn overlay_get_taskbar_bounds() -> Result<TaskbarBoundsDto, String> {
    query_taskbar_bounds()
}

#[tauri::command]
pub async fn overlay_dock_to_taskbar<R: tauri::Runtime>(
    window: Window<R>,
    position: Option<String>,
) -> Result<TaskbarBoundsDto, String> {
    let bounds = query_taskbar_bounds()?;
    let dock_position = normalize_dock_position(position.as_deref(), &bounds.position)?;

    let outer_size = window
        .outer_size()
        .map_err(|error| format!("Falha ao obter tamanho da janela: {error}"))?;

    let window_width = i32::try_from(outer_size.width)
        .map_err(|_| "Largura da janela excede o intervalo suportado".to_string())?;

    let window_height = i32::try_from(outer_size.height)
        .map_err(|_| "Altura da janela excede o intervalo suportado".to_string())?;

    let (x, y) = calculate_dock_position(
        &bounds,
        dock_position,
        window_width,
        window_height,
    );

    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| format!("Falha ao posicionar janela junto à barra de tarefas: {error}"))?;

    Ok(bounds)
}

fn normalize_dock_position<'a>(
    requested: Option<&'a str>,
    detected: &'a str,
) -> Result<&'a str, String> {
    let selected = requested.unwrap_or(detected);

    match selected {
        "top" | "bottom" | "left" | "right" => Ok(selected),
        _ => Err(format!("Posição de dock inválida: {selected}")),
    }
}

fn calculate_dock_position(
    bounds: &TaskbarBoundsDto,
    position: &str,
    window_width: i32,
    window_height: i32,
) -> (i32, i32) {
    match position {
        "bottom" => (
            bounds.x + (bounds.width - window_width) / 2,
            bounds.y - window_height,
        ),
        "top" => (
            bounds.x + (bounds.width - window_width) / 2,
            bounds.y + bounds.height,
        ),
        "left" => (
            bounds.x + bounds.width,
            bounds.y + (bounds.height - window_height) / 2,
        ),
        "right" => (
            bounds.x - window_width,
            bounds.y + (bounds.height - window_height) / 2,
        ),
        _ => (bounds.x, bounds.y),
    }
}

fn query_taskbar_bounds() -> Result<TaskbarBoundsDto, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW,
            GetWindowRect,
        };

        unsafe {
            let class_name: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
            let hwnd = FindWindowW(class_name.as_ptr(), std::ptr::null());

            if !hwnd.is_null() {
                let mut rect: RECT = std::mem::zeroed();

                if GetWindowRect(hwnd, &mut rect) != 0 {
                    let width = rect.right - rect.left;
                    let height = rect.bottom - rect.top;

                    if width > 0 && height > 0 {
                        let position = detect_taskbar_position(&rect, width, height);

                        return Ok(TaskbarBoundsDto {
                            x: rect.left,
                            y: rect.top,
                            width,
                            height,
                            position: position.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(TaskbarBoundsDto {
        x: 0,
        y: 1040,
        width: 1920,
        height: 40,
        position: "bottom".to_string(),
    })
}

#[cfg(target_os = "windows")]
fn detect_taskbar_position(
    rect: &windows_sys::Win32::Foundation::RECT,
    width: i32,
    height: i32,
) -> &'static str {
    if width >= height {
        if rect.top > 0 {
            "bottom"
        } else {
            "top"
        }
    } else if rect.left > 0 {
        "right"
    } else {
        "left"
    }
}
