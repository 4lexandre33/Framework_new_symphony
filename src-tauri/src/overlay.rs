use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{PhysicalPosition, Position, Window};

/// Estado do passthrough (não há getter nativo no Tauri): só muda quando o
/// comando nativo TEVE sucesso, então reflete o estado real aplicado.
static IGNORE_CURSOR_EVENTS: AtomicBool = AtomicBool::new(false);

const UNSUPPORTED_PREFIX: &str = "unsupported:";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarBoundsDto {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub position: String,
}

/// Estado REAL da janela, lido do sistema (G121).
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayWindowStateDto {
    pub always_on_top: bool,
    pub decorations: bool,
    pub ignore_cursor_events: bool,
    pub taskbar_supported: bool,
    pub platform: String,
}

/// Cursor relativo ao canto superior esquerdo da área cliente, em px CSS.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorPositionDto {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
}

#[tauri::command]
pub async fn overlay_set_ignore_cursor_events<R: tauri::Runtime>(
    window: Window<R>,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| format!("Falha ao alterar passthrough do mouse: {error}"))?;

    IGNORE_CURSOR_EVENTS.store(ignore, Ordering::SeqCst);
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
pub async fn overlay_set_decorations<R: tauri::Runtime>(
    window: Window<R>,
    decorations: bool,
) -> Result<(), String> {
    window
        .set_decorations(decorations)
        .map_err(|error| format!("Falha ao alterar bordas da janela: {error}"))
}

#[tauri::command]
pub async fn overlay_get_window_state<R: tauri::Runtime>(
    window: Window<R>,
) -> Result<OverlayWindowStateDto, String> {
    let always_on_top = window
        .is_always_on_top()
        .map_err(|error| format!("Falha ao ler AlwaysOnTop: {error}"))?;
    let decorations = window
        .is_decorated()
        .map_err(|error| format!("Falha ao ler bordas da janela: {error}"))?;
    Ok(OverlayWindowStateDto {
        always_on_top,
        decorations,
        ignore_cursor_events: IGNORE_CURSOR_EVENTS.load(Ordering::SeqCst),
        taskbar_supported: query_taskbar_bounds(&window).is_ok(),
        platform: std::env::consts::OS.to_string(),
    })
}

/// G15: posição real do cursor mesmo com a janela ignorando o mouse (o
/// webview não recebe eventos de mouse em passthrough).
#[tauri::command]
pub async fn overlay_get_cursor_position<R: tauri::Runtime>(
    window: Window<R>,
) -> Result<CursorPositionDto, String> {
    let cursor = window
        .cursor_position()
        .map_err(|error| format!("Falha ao ler posição do cursor: {error}"))?;
    let origin = window
        .inner_position()
        .map_err(|error| format!("Falha ao ler posição da janela: {error}"))?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Falha ao ler tamanho da janela: {error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("Falha ao ler escala da janela: {error}"))?;
    Ok(cursor_relative_to_window(
        (cursor.x, cursor.y),
        (origin.x, origin.y),
        (size.width, size.height),
        scale,
    ))
}

#[tauri::command]
pub async fn overlay_get_taskbar_bounds<R: tauri::Runtime>(
    window: Window<R>,
) -> Result<TaskbarBoundsDto, String> {
    query_taskbar_bounds(&window)
}

#[tauri::command]
pub async fn overlay_dock_to_taskbar<R: tauri::Runtime>(
    window: Window<R>,
    position: Option<String>,
) -> Result<TaskbarBoundsDto, String> {
    let bounds = query_taskbar_bounds(&window)?;
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

pub(crate) fn cursor_relative_to_window(
    cursor: (f64, f64),
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
) -> CursorPositionDto {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let px = cursor.0 - f64::from(origin.0);
    let py = cursor.1 - f64::from(origin.1);
    let inside = px >= 0.0 && py >= 0.0 && px < f64::from(size.0) && py < f64::from(size.1);
    CursorPositionDto {
        x: px / scale,
        y: py / scale,
        inside,
    }
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

/// Deriva a barra de tarefas da diferença entre o monitor e a sua área de
/// trabalho (`work_area`). Sem diferença (barra oculta/auto-hide, ou SO que
/// não informa a área de trabalho) = não suportado.
pub(crate) fn taskbar_from_work_area(
    monitor: (i32, i32, i32, i32),
    work: (i32, i32, i32, i32),
) -> Option<TaskbarBoundsDto> {
    let (mx, my, mw, mh) = monitor;
    let (wx, wy, ww, wh) = work;
    if mw <= 0 || mh <= 0 || ww <= 0 || wh <= 0 {
        return None;
    }
    let top = wy - my;
    let bottom = (my + mh) - (wy + wh);
    let left = wx - mx;
    let right = (mx + mw) - (wx + ww);
    let max = top.max(bottom).max(left).max(right);
    if max <= 0 {
        return None;
    }
    let dto = if max == bottom {
        TaskbarBoundsDto { x: mx, y: wy + wh, width: mw, height: bottom, position: "bottom".into() }
    } else if max == top {
        TaskbarBoundsDto { x: mx, y: my, width: mw, height: top, position: "top".into() }
    } else if max == left {
        TaskbarBoundsDto { x: mx, y: my, width: left, height: mh, position: "left".into() }
    } else {
        TaskbarBoundsDto { x: wx + ww, y: my, width: right, height: mh, position: "right".into() }
    };
    Some(dto)
}

fn query_taskbar_bounds<R: tauri::Runtime>(window: &Window<R>) -> Result<TaskbarBoundsDto, String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(bounds) = query_windows_shell_tray() {
            return Ok(bounds);
        }
    }

    let monitor = window
        .current_monitor()
        .map_err(|error| format!("Falha ao ler monitor atual: {error}"))?
        .ok_or_else(|| format!("{UNSUPPORTED_PREFIX} monitor atual desconhecido"))?;

    let size = monitor.size();
    let position = monitor.position();
    let work = monitor.work_area();
    let as_i32 = |v: u32| i32::try_from(v).unwrap_or(i32::MAX);

    taskbar_from_work_area(
        (position.x, position.y, as_i32(size.width), as_i32(size.height)),
        (
            work.position.x,
            work.position.y,
            as_i32(work.size.width),
            as_i32(work.size.height),
        ),
    )
    .ok_or_else(|| {
        format!(
            "{UNSUPPORTED_PREFIX} barra de tarefas não detectável neste sistema ({}): área de trabalho igual ao monitor",
            std::env::consts::OS
        )
    })
}

#[cfg(target_os = "windows")]
fn query_windows_shell_tray() -> Option<TaskbarBoundsDto> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};

    unsafe {
        let class_name: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        let hwnd = FindWindowW(class_name.as_ptr(), std::ptr::null());

        if hwnd.is_null() {
            return None;
        }
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }
        let position = detect_taskbar_position(&rect, width, height);
        Some(TaskbarBoundsDto {
            x: rect.left,
            y: rect.top,
            width,
            height,
            position: position.to_string(),
        })
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taskbar_derived_from_work_area() {
        let b = taskbar_from_work_area((0, 0, 1920, 1080), (0, 0, 1920, 1040)).unwrap();
        assert_eq!(b, TaskbarBoundsDto { x: 0, y: 1040, width: 1920, height: 40, position: "bottom".into() });
        let l = taskbar_from_work_area((0, 0, 1920, 1080), (60, 0, 1860, 1080)).unwrap();
        assert_eq!(l.position, "left");
        assert_eq!(l.width, 60);
        let t = taskbar_from_work_area((1920, 0, 1920, 1080), (1920, 25, 1920, 1055)).unwrap();
        assert_eq!((t.position.as_str(), t.x, t.height), ("top", 1920, 25));
        assert!(taskbar_from_work_area((0, 0, 1920, 1080), (0, 0, 1920, 1080)).is_none());
    }

    #[test]
    fn cursor_conversion_to_css_px() {
        let c = cursor_relative_to_window((300.0, 250.0), (100, 50), (800, 600), 2.0);
        assert!(c.inside);
        assert_eq!((c.x, c.y), (100.0, 100.0));
        let out = cursor_relative_to_window((50.0, 50.0), (100, 50), (800, 600), 1.0);
        assert!(!out.inside);
    }

    #[test]
    fn dock_position_validation() {
        assert!(normalize_dock_position(Some("diagonal"), "bottom").is_err());
        assert_eq!(normalize_dock_position(None, "left").unwrap(), "left");
    }
}
