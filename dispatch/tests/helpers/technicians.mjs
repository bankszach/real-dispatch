export function buildTechnicianSeedSql(technicians = []) {
  if (!Array.isArray(technicians) || technicians.length === 0) {
    return "";
  }

  const entries = technicians.filter(Boolean);
  const sqlLines = [];

  for (const entry of entries) {
    const id = String(entry?.id ?? "").trim();
    const name = String(entry?.name ?? "").trim();
    if (id === "" || name === "") {
      continue;
    }

    const active = entry.active === false ? "FALSE" : "TRUE";
    const homeRegion = entry.home_region == null ? null : String(entry.home_region).trim();
    const safeHomeRegion = homeRegion == null || homeRegion === "" ? "NULL" : quote(homeRegion);

    sqlLines.push(
      `INSERT INTO technicians (id, name, active, home_region) VALUES (${quote(id)}, ${quote(name)}, ${active}, ${safeHomeRegion}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, home_region = EXCLUDED.home_region;`,
    );

    const skills = Array.isArray(entry.skills) ? entry.skills : [];
    for (const skill of skills) {
      const rawSkill = String(skill ?? "")
        .trim()
        .toUpperCase();
      if (rawSkill === "") {
        continue;
      }
      sqlLines.push(
        `INSERT INTO technician_skills (technician_id, skill) VALUES (${quote(id)}, ${quote(rawSkill)}) ON CONFLICT (technician_id, skill) DO NOTHING;`,
      );
    }

    const regions = Array.isArray(entry.regions) ? entry.regions : [];
    for (const region of regions) {
      const rawRegion = String(region ?? "")
        .trim()
        .toUpperCase();
      if (rawRegion === "") {
        continue;
      }
      sqlLines.push(
        `INSERT INTO technician_regions (technician_id, region) VALUES (${quote(id)}, ${quote(rawRegion)}) ON CONFLICT (technician_id, region) DO NOTHING;`,
      );
    }

    const availability = Array.isArray(entry.availability) ? entry.availability : [];
    for (const availabilityWindow of availability) {
      const weekday = Number(availabilityWindow?.weekday);
      const startTime = String(
        availabilityWindow?.start_time ?? availabilityWindow?.startTime ?? "",
      ).trim();
      const endTime = String(
        availabilityWindow?.end_time ?? availabilityWindow?.endTime ?? "",
      ).trim();
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        continue;
      }
      if (!isValidTime(startTime) || !isValidTime(endTime)) {
        continue;
      }
      sqlLines.push(
        `INSERT INTO technician_availability (technician_id, weekday, start_time, end_time) VALUES (${quote(id)}, ${weekday}, ${quote(startTime)}, ${quote(endTime)}) ON CONFLICT (technician_id, weekday, start_time) DO NOTHING;`,
      );
    }
  }

  return sqlLines.join("\n");
}

function quote(raw) {
  const value = String(raw).replaceAll("'", "''");
  return `'${value}'`;
}

function isValidTime(raw) {
  return /^([0-1]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(raw ?? ""));
}
