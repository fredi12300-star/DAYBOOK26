/**
 * Combines a base attendance date (YYYY-MM-DD) and a time input (HH:mm)
 * into a full ISO string, respecting the shift's workday boundary.
 * 
 * If the time input is LESS than the boundary start time, it is assumed
 * to belong to the NEXT calendar day (cross-midnight).
 */
export function combineDateAndTimeWithBoundary(
    attendanceDate: string,
    timeInput: string | null,
    boundaryStart: string = '06:00'
): string | null {
    if (!timeInput) return null;

    const [year, month, day] = attendanceDate.split('-').map(Number);
    const [hours, minutes] = timeInput.split(':').map(Number);
    const [bHours, bMinutes] = boundaryStart.split(':').map(Number);

    const baseDate = new Date(year, month - 1, day, hours, minutes);

    // Boundary comparison (in minutes from midnight)
    const inputMinutes = hours * 60 + minutes;
    const boundaryMinutes = bHours * 60 + bMinutes;

    if (inputMinutes < boundaryMinutes) {
        // Cross-midnight: Add 1 day
        baseDate.setDate(baseDate.getDate() + 1);
    }

    return baseDate.toISOString();
}

/**
 * Extracts the local time (HH:mm) from an ISO string for display in <input type="time">.
 */
export function formatISOToLocalTime(isoString: string | null): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Returns today's date in YYYY-MM-DD format respecting the local timezone.
 */
export function getLocalTodayISO(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Returns the local start and end of a given month in YYYY-MM-DD format.
 */
export function getMonthRangeLocal(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}
/**
 * Returns yesterday's date in YYYY-MM-DD format respecting the local timezone.
 */
export function getYesterdayISO(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
