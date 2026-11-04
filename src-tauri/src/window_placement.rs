//! Window bounds in physical pixels. Native adapters supply the actual work
//! area and frame extents; no taskbar height or DPI is guessed here.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn overlap(self, other: Self) -> u64 {
        let width = (i64::from(self.x) + i64::from(self.width))
            .min(i64::from(other.x) + i64::from(other.width))
            - i64::from(self.x).max(i64::from(other.x));
        let height = (i64::from(self.y) + i64::from(self.height))
            .min(i64::from(other.y) + i64::from(other.height))
            - i64::from(self.y).max(i64::from(other.y));
        width.max(0) as u64 * height.max(0) as u64
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Placement {
    pub outer: Rect,
    pub inner_size: (u32, u32),
    pub min_inner_size: (u32, u32),
}

pub(super) fn select_work_area(
    areas: &[Rect],
    preferred: usize,
    saved: Option<Rect>,
) -> Option<Rect> {
    let mut selected = None;
    let mut overlap = 0;
    if let Some(saved) = saved {
        for &area in areas {
            let candidate = area.overlap(saved);
            if candidate > overlap {
                selected = Some(area);
                overlap = candidate;
            }
        }
    }
    selected.or_else(|| {
        areas
            .get(preferred)
            .copied()
            .filter(|a| a.width > 0 && a.height > 0)
            .or_else(|| areas.iter().copied().find(|a| a.width > 0 && a.height > 0))
    })
}

pub(super) fn fit_main_window(
    work: Rect,
    scale: f64,
    frame: (u32, u32),
    saved: Option<Rect>,
) -> Option<Placement> {
    if !scale.is_finite() || scale <= 0.0 || 1320.0 * scale > f64::from(u32::MAX) {
        return None;
    }
    let available = (
        work.width.checked_sub(frame.0)?,
        work.height.checked_sub(frame.1)?,
    );
    if available.0 == 0 || available.1 == 0 {
        return None;
    }
    let pixels = |logical: f64| (logical * scale).round().max(1.0) as u32;
    let minimum = (
        pixels(960.0).min(available.0),
        pixels(600.0).min(available.1),
    );
    // A missing monitor or invalid rectangle gets the first-launch placement.
    let saved = saved.filter(|r| r.width > frame.0 && r.height > frame.1 && r.overlap(work) > 0);
    let desired = saved
        .map(|r| (r.width - frame.0, r.height - frame.1))
        .unwrap_or_else(|| (pixels(1320.0), pixels(820.0)));
    let inner = (
        desired.0.clamp(minimum.0, available.0),
        desired.1.clamp(minimum.1, available.1),
    );
    let width = inner.0 + frame.0;
    let height = inner.1 + frame.1;
    let (x, y) = saved
        .map(|r| (i64::from(r.x), i64::from(r.y)))
        .unwrap_or_else(|| {
            (
                i64::from(work.x) + i64::from((work.width - width) / 2),
                i64::from(work.y) + i64::from((work.height - height) / 2),
            )
        });
    let x = x.clamp(
        i64::from(work.x),
        i64::from(work.x) + i64::from(work.width - width),
    );
    let y = y.clamp(
        i64::from(work.y),
        i64::from(work.y) + i64::from(work.height - height),
    );
    Some(Placement {
        outer: Rect {
            x: x.try_into().ok()?,
            y: y.try_into().ok()?,
            width,
            height,
        },
        inner_size: inner,
        min_inner_size: minimum,
    })
}

/// Place a frameless Quick Chat next to the tray, staying inside usable pixels.
/// Tray overflow rectangles can be inside the work area; the closest edge still
/// determines which side of the icon leaves room for the chat.
pub(super) fn fit_quick_chat(
    work: Rect,
    desired: (u32, u32),
    tray: Option<Rect>,
    gap: u32,
) -> Option<Rect> {
    let width = desired.0.min(work.width);
    let height = desired.1.min(work.height);
    if width == 0 || height == 0 {
        return None;
    }
    let left = i64::from(work.x);
    let top = i64::from(work.y);
    let right = left + i64::from(work.width);
    let bottom = top + i64::from(work.height);
    let margin_x = i64::from(gap.min((work.width - width) / 2));
    let margin_y = i64::from(gap.min((work.height - height) / 2));
    let w = i64::from(width);
    let h = i64::from(height);
    let gap = i64::from(gap);
    let (x, y) = if let Some(tray) = tray.filter(|r| r.width > 0 && r.height > 0) {
        let tx = i64::from(tray.x);
        let ty = i64::from(tray.y);
        let tw = i64::from(tray.width);
        let th = i64::from(tray.height);
        let cx = tx + tw / 2;
        let cy = ty + th / 2;
        // Prefer the bottom edge for an exact corner tie.
        let edge = [
            (cy - bottom).abs(),
            (cy - top).abs(),
            (cx - left).abs(),
            (cx - right).abs(),
        ]
        .iter()
        .enumerate()
        .min_by_key(|(_, distance)| **distance)
        .map(|(edge, _)| edge)?;
        match edge {
            0 => (cx - w / 2, ty - h - gap),
            1 => (cx - w / 2, ty + th + gap),
            2 => (tx + tw + gap, cy - h / 2),
            _ => (tx - w - gap, cy - h / 2),
        }
    } else {
        (right - w - margin_x, bottom - h - margin_y)
    };
    Some(Rect {
        x: x.clamp(left + margin_x, right - w - margin_x)
            .try_into()
            .ok()?,
        y: y.clamp(top + margin_y, bottom - h - margin_y)
            .try_into()
            .ok()?,
        width,
        height,
    })
}

pub(super) fn fit_quick_chat_client(
    work: Rect,
    scale: f64,
    desired: (u32, u32),
    frame: (u32, u32),
    tray: Option<Rect>,
) -> Option<Placement> {
    if !scale.is_finite() || scale <= 0.0 || 420.0 * scale > f64::from(u32::MAX) {
        return None;
    }
    let available = (
        work.width.checked_sub(frame.0)?,
        work.height.checked_sub(frame.1)?,
    );
    if available.0 == 0 || available.1 == 0 {
        return None;
    }
    let pixels = |logical: f64| (logical * scale).round().max(1.0) as u32;
    let minimum = (
        pixels(340.0).min(available.0),
        pixels(420.0).min(available.1),
    );
    let inner = (
        desired.0.clamp(minimum.0, available.0),
        desired.1.clamp(minimum.1, available.1),
    );
    let outer = fit_quick_chat(
        work,
        (inner.0 + frame.0, inner.1 + frame.1),
        tray,
        pixels(8.0),
    )?;
    Some(Placement {
        outer,
        inner_size: inner,
        min_inner_size: minimum,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_chat_accounts_for_shadow_frame_and_yields_minimum_on_small_work_area() {
        let p =
            fit_quick_chat_client(rect(0, 0, 500, 400), 1.5, (585, 780), (16, 16), None).unwrap();
        assert_eq!(p.outer, rect(0, 0, 500, 400));
        assert_eq!(p.inner_size, (484, 384));
        assert_eq!(p.min_inner_size, (484, 384));
        assert_eq!(
            fit_quick_chat_client(rect(0, 0, 16, 16), 1.0, (390, 520), (16, 16), None),
            None
        );
    }

    #[test]
    fn quick_chat_sits_above_bottom_tray_inside_work_area() {
        assert_eq!(
            fit_quick_chat(
                rect(0, 0, 1920, 1040),
                (390, 520),
                Some(rect(1800, 1040, 24, 40)),
                8
            ),
            Some(rect(1522, 512, 390, 520))
        );
    }

    #[test]
    fn quick_chat_handles_top_and_side_taskbars() {
        assert_eq!(
            fit_quick_chat(
                rect(0, 40, 1920, 1040),
                (390, 520),
                Some(rect(1700, 0, 24, 40)),
                8
            ),
            Some(rect(1517, 48, 390, 520))
        );
        assert_eq!(
            fit_quick_chat(
                rect(40, 0, 1880, 1080),
                (390, 520),
                Some(rect(0, 900, 40, 24)),
                8
            ),
            Some(rect(48, 552, 390, 520))
        );
    }

    #[test]
    fn quick_chat_uses_tray_overflow_rect_and_negative_origin() {
        assert_eq!(
            fit_quick_chat(
                rect(-1920, 0, 1920, 1040),
                (390, 520),
                Some(rect(-200, 850, 24, 24)),
                8
            ),
            Some(rect(-398, 322, 390, 520))
        );
        assert_eq!(
            fit_quick_chat(
                rect(-1920, 0, 1920, 1040),
                (390, 520),
                Some(rect(-24, 400, 24, 24)),
                8
            ),
            Some(rect(-422, 152, 390, 520))
        );
    }

    #[test]
    fn quick_chat_without_tray_falls_back_to_work_area_bottom_right() {
        assert_eq!(
            fit_quick_chat(rect(-1920, 0, 1920, 1040), (390, 520), None, 8),
            Some(rect(-398, 512, 390, 520))
        );
    }

    #[test]
    fn quick_chat_shrinks_to_tiny_work_area_and_rejects_empty_bounds() {
        assert_eq!(
            fit_quick_chat(rect(20, 30, 100, 80), (390, 520), None, 8),
            Some(rect(20, 30, 100, 80))
        );
        assert_eq!(fit_quick_chat(rect(0, 0, 0, 80), (390, 520), None, 8), None);
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn first_launch_fits_laptop_work_area_including_native_frame() {
        let p = fit_main_window(rect(0, 0, 1366, 728), 1.0, (16, 39), None).unwrap();
        assert_eq!(p.outer, rect(15, 0, 1336, 728));
        assert_eq!(p.inner_size, (1320, 689));
        assert_eq!(p.min_inner_size, (960, 600));
    }

    #[test]
    fn scaled_display_does_not_apply_dpi_twice_or_ignore_taskbar() {
        let p = fit_main_window(rect(0, 0, 1920, 1020), 1.5, (24, 58), None).unwrap();
        assert_eq!(p.outer, rect(0, 0, 1920, 1020));
        assert_eq!(p.inner_size, (1896, 962));
        assert_eq!(p.min_inner_size, (1440, 900));
    }

    #[test]
    fn valid_saved_position_and_size_are_preserved_on_negative_origin_monitor() {
        let saved = rect(-1700, 50, 1100, 700);
        let p = fit_main_window(rect(-1920, 0, 1920, 1040), 1.0, (16, 39), Some(saved)).unwrap();
        assert_eq!(p.outer, saved);
        assert_eq!(p.inner_size, (1084, 661));
    }

    #[test]
    fn removed_monitor_restores_centered_default_on_available_monitor() {
        let p = fit_main_window(
            rect(0, 0, 1920, 1040),
            1.0,
            (16, 39),
            Some(rect(-1900, 0, 1200, 800)),
        )
        .unwrap();
        assert_eq!(p.outer, rect(292, 90, 1336, 859));
    }

    #[test]
    fn partly_offscreen_saved_window_is_clamped_and_minimum_yields_to_work_area() {
        let p = fit_main_window(
            rect(0, 40, 800, 500),
            1.0,
            (16, 39),
            Some(rect(700, 400, 1200, 900)),
        )
        .unwrap();
        assert_eq!(p.outer, rect(0, 40, 800, 500));
        assert_eq!(p.inner_size, (784, 461));
        assert_eq!(p.min_inner_size, (784, 461));
    }

    #[test]
    fn monitor_selection_uses_largest_overlap_then_preferred_fallback() {
        let monitors = [rect(-1920, 0, 1920, 1040), rect(0, 0, 2560, 1400)];
        assert_eq!(
            select_work_area(&monitors, 1, Some(rect(-500, 20, 1200, 800))),
            Some(monitors[1])
        );
        assert_eq!(
            select_work_area(&monitors, 1, Some(rect(-1800, 20, 1200, 800))),
            Some(monitors[0])
        );
        assert_eq!(
            select_work_area(&monitors, 1, Some(rect(9000, 0, 1200, 800))),
            Some(monitors[1])
        );
        assert_eq!(select_work_area(&[], 0, None), None);
    }

    #[test]
    fn invalid_scale_or_impossible_frame_has_no_valid_placement() {
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                fit_main_window(rect(0, 0, 1000, 700), scale, (16, 39), None),
                None
            );
        }
        assert_eq!(
            fit_main_window(rect(0, 0, 16, 39), 1.0, (16, 39), None),
            None
        );
    }

    #[test]
    fn invalid_saved_size_falls_back_and_extreme_coordinates_do_not_overflow() {
        let work = rect(i32::MAX - 2000, i32::MIN + 100, 1920, 1040);
        let p = fit_main_window(work, 1.0, (16, 39), Some(rect(0, 0, 0, u32::MAX))).unwrap();
        assert_eq!(p.outer, rect(i32::MAX - 1708, i32::MIN + 190, 1336, 859));
    }
}
