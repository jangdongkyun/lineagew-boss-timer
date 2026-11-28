/**
 * LINEAGE W clan-chat command parser.
 * Accepts only explicit commands:
 *   컷 <boss name or alias> HH:mm
 *   취소 <boss name or alias> HH:mm
 *
 * This module parses text only. It never writes to Supabase.
 */

function normalizeBossKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

export function parseClanChatCommand(message, bosses = []) {
  const source = String(message ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  const match = source.match(/^(컷|취소)\s+(.+?)\s+(\d{1,2}):(\d{2})$/u);

  if (!match) {
    return { ok: false, reason: "not_command" };
  }

  const [, command, bossText, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, reason: "invalid_time" };
  }

  const target = normalizeBossKey(bossText);
  if (!target) return { ok: false, reason: "missing_boss" };

  const matches = [];
  for (const boss of Array.isArray(bosses) ? bosses : []) {
    if (!boss || boss.is_active === false) continue;

    const names = [boss.name, ...(Array.isArray(boss.aliases) ? boss.aliases : [])]
      .filter(value => typeof value === "string" && value.trim());

    if (names.some(name => normalizeBossKey(name) === target)) {
      if (!matches.some(item => String(item.id) === String(boss.id))) {
        matches.push(boss);
      }
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: "unknown_boss", bossText };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_boss",
      bossText,
      candidates: matches.map(boss => ({ id: boss.id, name: boss.name }))
    };
  }

  const boss = matches[0];
  return {
    ok: true,
    action: command === "컷" ? "cut" : "cancel",
    bossId: boss.id,
    bossName: boss.name,
    matchedText: bossText,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  };
}
