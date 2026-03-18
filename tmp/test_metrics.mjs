import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1]?.trim() || 'https://xdfjajowlyrmfczzztth.supabase.co';
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim();

if (!supabaseKey) {
    console.error("No VITE_SUPABASE_ANON_KEY in env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTime() {
    const parseTimeToMins = (timeInput, isUtc = false) => {
        if (!timeInput) return null;
        
        if (timeInput.includes('T')) {
            const date = new Date(timeInput);
            if (isNaN(date.getTime())) return null;
            return date.getHours() * 60 + date.getMinutes();
        }

        const parts = timeInput.split(':');
        if (parts.length >= 2) {
            let mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            if (isUtc) {
                const offset = new Date().getTimezoneOffset();
                mins = mins - offset;
                if (mins < 0) mins += 24 * 60;
                if (mins >= 24 * 60) mins -= 24 * 60;
            }
            return mins;
        }
        
        return null;
    };

    const { data: staff, error: staffErr } = await supabase
        .from('staff_master')
        .select(`
            id, full_name, shift_group_id,
            shift_groups (
                id, name, start_time, end_time, grace_in_minutes, grace_out_minutes, break_duration_minutes
            )
        `)
        .ilike('full_name', '%SALY%');
        
    if (staffErr || !staff || staff.length === 0) {
        console.error("Error fetching staff:", staffErr);
        return;
    }

    const s = staff[0];
    console.log("Found Saly:", s);
    
    // Check if shift_groups is returned. (If joined correctly, it's either an array or an object)
    let shiftGroup = Array.isArray(s.shift_groups) ? s.shift_groups[0] : s.shift_groups;
    
    // fallback if no relation works easily:
    if (!shiftGroup) {
        const { data: sg } = await supabase.from('shift_groups').select('*').eq('id', s.shift_group_id);
        if (sg && sg.length > 0) shiftGroup = sg[0];
    }
    
    console.log("Shift Group rules:", shiftGroup);

    const { data: records, error: recErr } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('staff_id', s.id);
        
    console.log(`Found ${records?.length} attendance records.`);

    if (!shiftGroup) return;

    let late = 0;
    let early = 0;
    let overBreak = 0;

    const shiftStart = parseTimeToMins(shiftGroup.start_time);
    const shiftEnd = parseTimeToMins(shiftGroup.end_time);
    const graceIn = shiftGroup.grace_in_minutes || 0;
    const graceOut = shiftGroup.grace_out_minutes || 0;
    const breakDur = shiftGroup.break_duration_minutes || 0;

    console.log(`\n=== METRICS RUN ==`);
    console.log(`shiftStart: ${shiftStart}, shiftEnd: ${shiftEnd}`);
    console.log(`graceIn: ${graceIn}, graceOut: ${graceOut}, breakDur: ${breakDur}`);

    records.forEach(hr => {
        if (hr.status === 'HOLIDAY' || hr.status === 'LEAVE' || hr.status === 'WEEKLY_OFF') return;

        const pi = parseTimeToMins(hr.punch_in, true);
        const po = parseTimeToMins(hr.punch_out, true);
        const li = parseTimeToMins(hr.lunch_in, true);
        const lo = parseTimeToMins(hr.lunch_out, true);
        
        console.log(`\nDate: ${hr.attendance_date} | pi: ${pi}, po: ${po}, li: ${li}, lo: ${lo}`);

        if (shiftStart !== null && pi !== null && pi > shiftStart + graceIn) {
            const excuse = hr.excused_late_minutes || 0;
            const lateMins = (pi - shiftStart) - excuse;
            console.log(`  --> LATE: ${lateMins} mins (pi ${pi} > shiftStart+graceIn ${shiftStart + graceIn})`);
            if (lateMins > 0) late += lateMins;
        }

        if (shiftEnd !== null && po !== null && po < shiftEnd - graceOut) {
            const earlyMins = shiftEnd - po;
            console.log(`  --> EARLY: ${earlyMins} mins (po ${po} < shiftEnd-graceOut ${shiftEnd - graceOut})`);
            if (earlyMins > 0) early += earlyMins;
        }

        if (li !== null && lo !== null && li > lo) {
            const taken = li - lo;
            console.log(`  --> BREAK TAKEN: ${taken} mins`);
            if (taken > breakDur) {
                const overMins = taken - breakDur;
                console.log(`  --> OVER BREAK: ${overMins} mins`);
                overBreak += overMins;
            }
        }
    });

    console.log(`\nFINAL TOTALS: late=${late}, early=${early}, overBreak=${overBreak}`);
}

checkTime();
