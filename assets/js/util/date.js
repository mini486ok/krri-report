// 날짜 유틸. 주례 = 해당 주 월~금, 월례 = 해당 월 1일~말일. 모두 한국시간 기준으로 문자열만 다룸.

function toLocalDate(isoYmd) {
  // "2026-04-21" → Date (로컬 자정)
  const [y, m, d] = isoYmd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function pad2(n) { return String(n).padStart(2, '0'); }

export function formatMDDot(date) {
  return `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}.`;
}

export function formatYMDDash(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 주례 범위: 기준일이 속한 주의 월요일~금요일
export function weeklyRange(baseIsoYmd) {
  const d = toLocalDate(baseIsoYmd);
  // Sunday=0, Monday=1 ... Saturday=6
  const dayOfWeek = d.getDay();
  // 일요일이면 직전 월요일(=6일 전)
  const deltaToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + deltaToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    rangeStart: formatMDDot(monday),
    rangeEnd: formatMDDot(friday),
    rangeStartIso: formatYMDDash(monday),
    rangeEndIso: formatYMDDash(friday),
  };
}

// 이번 주 계획: 다음 주 월~금
export function nextWeeklyRange(baseIsoYmd) {
  const this_ = weeklyRange(baseIsoYmd);
  const thisMon = toLocalDate(this_.rangeStartIso);
  const nextMon = new Date(thisMon);
  nextMon.setDate(thisMon.getDate() + 7);
  const nextFri = new Date(nextMon);
  nextFri.setDate(nextMon.getDate() + 4);
  return {
    rangeStart: formatMDDot(nextMon),
    rangeEnd: formatMDDot(nextFri),
    rangeStartIso: formatYMDDash(nextMon),
    rangeEndIso: formatYMDDash(nextFri),
  };
}

// 월례 범위: 기준일이 속한 월 1일~말일
export function monthlyRange(baseIsoYmd) {
  const d = toLocalDate(baseIsoYmd);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    rangeStart: formatMDDot(first),
    rangeEnd: formatMDDot(last),
    rangeStartIso: formatYMDDash(first),
    rangeEndIso: formatYMDDash(last),
  };
}

// 월례 다음 달 범위
export function nextMonthlyRange(baseIsoYmd) {
  const d = toLocalDate(baseIsoYmd);
  const nextFirst = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const nextLast = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return {
    rangeStart: formatMDDot(nextFirst),
    rangeEnd: formatMDDot(nextLast),
    rangeStartIso: formatYMDDash(nextFirst),
    rangeEndIso: formatYMDDash(nextLast),
  };
}

export function computeRanges(form, baseIsoYmd) {
  if (form === 'monthly') {
    const a = monthlyRange(baseIsoYmd);
    const b = nextMonthlyRange(baseIsoYmd);
    return {
      rangeStart: a.rangeStart, rangeEnd: a.rangeEnd,
      nextRangeStart: b.rangeStart, nextRangeEnd: b.rangeEnd,
    };
  }
  const a = weeklyRange(baseIsoYmd);
  const b = nextWeeklyRange(baseIsoYmd);
  return {
    rangeStart: a.rangeStart, rangeEnd: a.rangeEnd,
    nextRangeStart: b.rangeStart, nextRangeEnd: b.rangeEnd,
  };
}

export function relativeTimeLabel(dateOrTimestamp) {
  if (!dateOrTimestamp) return '';
  const ms = dateOrTimestamp.toMillis
    ? dateOrTimestamp.toMillis()
    : (dateOrTimestamp instanceof Date ? dateOrTimestamp.getTime() : Number(dateOrTimestamp));
  const diff = Date.now() - ms;
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}
