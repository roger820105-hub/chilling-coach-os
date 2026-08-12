import crypto from "node:crypto";

/* =========================================================
   Chilling Coach OS
   LINE Bot V6 Complete
   ========================================================= */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

/* =========================================================
   LINE
   ========================================================= */

function verifySignature(raw, signature, secret) {
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

async function lineReply(replyToken, text, token) {
  const r = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    }
  );

  if (!r.ok) {
    throw new Error(`LINE_REPLY:${await r.text()}`);
  }
}

/* =========================================================
   SUPABASE
   ========================================================= */

const dbHeaders = (secret) => ({
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
});

/* =========================================================
   USER / ROLE
   ========================================================= */

async function getUser(url, secret, lineUserId) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/users?line_user_id=eq.${encodeURIComponent(
      lineUserId
    )}&is_active=eq.true&select=id,display_name`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  const rows = await r.json();

  if (!rows[0]) return null;

  const rr = await fetch(
    `${url}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(
      rows[0].id
    )}&select=role`,
    { headers: h }
  );

  if (!rr.ok) {
    throw new Error(await rr.text());
  }

  return {
    ...rows[0],
    roles: (await rr.json()).map((x) => x.role),
  };
}

/* =========================================================
   STUDENTS
   ========================================================= */

async function getStudents(url, secret, coachId) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/coach_students?coach_id=eq.${encodeURIComponent(
      coachId
    )}&ended_at=is.null&select=student_id`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  const ids = [
    ...new Set(
      (await r.json())
        .map((x) => x.student_id)
        .filter(Boolean)
    ),
  ];

  if (!ids.length) return [];

  const filter = ids
    .map((id) => `"${id}"`)
    .join(",");

  const s = await fetch(
    `${url}/rest/v1/students?id=in.(${encodeURIComponent(
      filter
    )})&select=id,name,status&order=name.asc`,
    { headers: h }
  );

  if (!s.ok) {
    throw new Error(await s.text());
  }

  return await s.json();
}

async function findStudent(
  url,
  secret,
  coachId,
  name
) {
  const all = await getStudents(
    url,
    secret,
    coachId
  );

  const q = name.trim().toLowerCase();

  const exact = all.filter(
    (s) =>
      s.name.trim().toLowerCase() === q
  );

  if (exact.length === 1) {
    return {
      status: "ok",
      student: exact[0],
    };
  }

  if (exact.length > 1) {
    return {
      status: "multiple",
    };
  }

  const partial = all.filter((s) =>
    s.name.toLowerCase().includes(q)
  );

  if (partial.length === 1) {
    return {
      status: "ok",
      student: partial[0],
    };
  }

  if (partial.length > 1) {
    return {
      status: "multiple",
    };
  }

  return {
    status: "not_found",
  };
}

function buildStudentMap(students) {
  const map = new Map();

  for (const student of students) {
    map.set(student.id, student);
  }

  return map;
}

/* =========================================================
   PACKAGES
   ========================================================= */

async function getActivePackage(
  url,
  secret,
  studentId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/packages?student_id=eq.${encodeURIComponent(
      studentId
    )}&status=eq.active&select=id,package_name,purchased_sessions,remaining_sessions,expires_at,status&order=purchased_at.desc&limit=1`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  return (await r.json())[0] || null;
}

async function getLatestPackage(
  url,
  secret,
  studentId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/packages?student_id=eq.${encodeURIComponent(
      studentId
    )}&select=id,package_name,purchased_sessions,remaining_sessions,expires_at,status,purchased_at&order=purchased_at.desc&limit=1`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  return (await r.json())[0] || null;
}

/* =========================================================
   TIME / TAIWAN
   ========================================================= */

function getTaiwanParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }
  ).formatToParts(date);

  return {
    year: Number(
      parts.find((x) => x.type === "year")?.value
    ),
    month: Number(
      parts.find((x) => x.type === "month")?.value
    ),
    day: Number(
      parts.find((x) => x.type === "day")?.value
    ),
  };
}

function taiwanBoundsFromParts(
  year,
  month,
  day
) {
  const start = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      -8,
      0,
      0
    )
  );

  const end = new Date(
    start.getTime() +
      24 * 60 * 60 * 1000
  );

  return {
    start,
    end,
  };
}

function taiwanBoundsOffset(days = 0) {
  const now = new Date();

  const p = getTaiwanParts(now);

  const localDate = new Date(
    Date.UTC(
      p.year,
      p.month - 1,
      p.day + days,
      0,
      0,
      0
    )
  );

  return taiwanBoundsFromParts(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate()
  );
}

function parseMonthDay(md, hm = "00:00") {
  const m = md.match(
    /^(\d{1,2})\/(\d{1,2})$/
  );

  const t = hm.match(
    /^(\d{1,2}):(\d{2})$/
  );

  if (!m || !t) return null;

  const nowParts = getTaiwanParts();

  let year = nowParts.year;

  const month = Number(m[1]);
  const day = Number(m[2]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let dt = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - 8,
      minute
    )
  );

  const now = new Date();

  if (
    (dt.getTime() - now.getTime()) /
      86400000 <
    -120
  ) {
    year += 1;

    dt = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        hour - 8,
        minute
      )
    );
  }

  return dt;
}

function taiwanDayBounds(md) {
  const m = md.match(
    /^(\d{1,2})\/(\d{1,2})$/
  );

  if (!m) return null;

  const nowParts = getTaiwanParts();

  let year = nowParts.year;

  const month = Number(m[1]);
  const day = Number(m[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  let bounds = taiwanBoundsFromParts(
    year,
    month,
    day
  );

  const now = new Date();

  if (
    (bounds.start.getTime() -
      now.getTime()) /
      86400000 <
    -120
  ) {
    bounds = taiwanBoundsFromParts(
      year + 1,
      month,
      day
    );
  }

  return bounds;
}

function formatTaiwanDate(iso) {
  return new Intl.DateTimeFormat(
    "zh-TW",
    {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
    }
  ).format(new Date(iso));
}

function formatTaiwanTime(iso) {
  return new Intl.DateTimeFormat(
    "zh-TW",
    {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(new Date(iso));
}

function formatTaiwanDateTime(iso) {
  return new Intl.DateTimeFormat(
    "zh-TW",
    {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(new Date(iso));
}

/* =========================================================
   SESSIONS
   ========================================================= */

async function createBooking(
  url,
  secret,
  coachId,
  studentId,
  packageId,
  when
) {
  const h = dbHeaders(secret);

  const collision = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&scheduled_at=eq.${encodeURIComponent(
      when.toISOString()
    )}&status=eq.scheduled&select=id`,
    { headers: h }
  );

  if (
    collision.ok &&
    (await collision.json()).length
  ) {
    return {
      status: "collision",
    };
  }

  const r = await fetch(
    `${url}/rest/v1/sessions`,
    {
      method: "POST",
      headers: {
        ...h,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        student_id: studentId,
        coach_id: coachId,
        package_id: packageId,
        scheduled_at: when.toISOString(),
        status: "scheduled",
      }),
    }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  return {
    status: "created",
    session: (await r.json())[0],
  };
}

async function getSessionsBetween(
  url,
  secret,
  coachId,
  start,
  end,
  statusFilter = null,
  order = "asc",
  limit = 100
) {
  const h = dbHeaders(secret);

  let statusQuery = "";

  if (statusFilter === "scheduled") {
    statusQuery = "&status=eq.scheduled";
  }

  if (statusFilter === "completed") {
    statusQuery = "&status=eq.completed";
  }

  if (statusFilter === "active") {
    statusQuery =
      "&status=in.(scheduled,completed)";
  }

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}${statusQuery}&scheduled_at=gte.${encodeURIComponent(
      start.toISOString()
    )}&scheduled_at=lt.${encodeURIComponent(
      end.toISOString()
    )}&select=id,student_id,coach_id,package_id,scheduled_at,completed_at,status&order=scheduled_at.${order}&limit=${limit}`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `GET_SESSIONS:${await r.text()}`
    );
  }

  return await r.json();
}

async function findScheduledSession(
  url,
  secret,
  coachId,
  studentId,
  dateText = null
) {
  const h = dbHeaders(secret);

  let start;
  let end;

  if (dateText) {
    const b =
      taiwanDayBounds(dateText);

    if (!b) {
      return {
        status: "bad_date",
      };
    }

    start = b.start;
    end = b.end;
  } else {
    const now = new Date();

    start = new Date(
      now.getTime() -
        12 * 60 * 60 * 1000
    );

    end = new Date(
      now.getTime() +
        6 * 60 * 60 * 1000
    );
  }

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&student_id=eq.${encodeURIComponent(
      studentId
    )}&status=eq.scheduled&scheduled_at=gte.${encodeURIComponent(
      start.toISOString()
    )}&scheduled_at=lt.${encodeURIComponent(
      end.toISOString()
    )}&select=id,student_id,scheduled_at,package_id,status&order=scheduled_at.asc`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  const rows = await r.json();

  if (!rows.length) {
    return {
      status: "none",
    };
  }

  if (rows.length > 1) {
    return {
      status: "multiple",
      sessions: rows,
    };
  }

  return {
    status: "ok",
    session: rows[0],
  };
}

async function findTrainingSession(
  url,
  secret,
  coachId,
  studentId,
  dateText
) {
  const h = dbHeaders(secret);

  const bounds =
    taiwanDayBounds(dateText);

  if (!bounds) {
    return {
      status: "bad_date",
    };
  }

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&student_id=eq.${encodeURIComponent(
      studentId
    )}&status=in.(scheduled,completed)&scheduled_at=gte.${encodeURIComponent(
      bounds.start.toISOString()
    )}&scheduled_at=lt.${encodeURIComponent(
      bounds.end.toISOString()
    )}&select=id,student_id,scheduled_at,package_id,status&order=scheduled_at.asc`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  const rows = await r.json();

  if (!rows.length) {
    return {
      status: "none",
    };
  }

  if (rows.length > 1) {
    return {
      status: "multiple",
      sessions: rows,
    };
  }

  return {
    status: "ok",
    session: rows[0],
  };
}

async function completeSession(
  url,
  secret,
  sessionId,
  coachId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/rpc/complete_session_and_deduct`,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        p_session_id: sessionId,
        p_coach_id: coachId,
      }),
    }
  );

  if (!r.ok) {
    const detail = await r.text();

    throw new Error(
      `COMPLETE:${detail}`
    );
  }

  const rows = await r.json();

  return rows[0];
}

/* =========================================================
   V6 SCHEDULE
   ========================================================= */

function getSessionStatusLabel(session) {
  if (session.status === "completed") {
    return "✅ 已完成";
  }

  if (
    session.status === "scheduled" &&
    new Date(session.scheduled_at) <
      new Date()
  ) {
    return "⚠️ 待完成";
  }

  return "🗓 已預約";
}

async function renderSchedule(
  url,
  secret,
  coachId,
  sessions,
  title
) {
  if (!sessions.length) {
    return `${title}\n\n目前沒有課程。`;
  }

  const students =
    await getStudents(
      url,
      secret,
      coachId
    );

  const studentMap =
    buildStudentMap(students);

  const packageCache =
    new Map();

  const lines = [];

  for (const session of sessions) {
    const student =
      studentMap.get(
        session.student_id
      );

    const name =
      student?.name || "未知學員";

    if (
      !packageCache.has(
        session.student_id
      )
    ) {
      const pkg =
        await getLatestPackage(
          url,
          secret,
          session.student_id
        );

      packageCache.set(
        session.student_id,
        pkg
      );
    }

    const pkg =
      packageCache.get(
        session.student_id
      );

    const remaining =
      pkg
        ? `${pkg.remaining_sessions}堂`
        : "—";

    lines.push(
      `${formatTaiwanTime(
        session.scheduled_at
      )}｜${name}\n${getSessionStatusLabel(
        session
      )}｜剩餘 ${remaining}`
    );
  }

  return `${title}\n\n${lines.join(
    "\n\n"
  )}`;
}

async function getUpcomingBookings(
  url,
  secret,
  coachId,
  days = 7
) {
  const now = new Date();

  const end = new Date(
    now.getTime() +
      days * 24 * 60 * 60 * 1000
  );

  return await getSessionsBetween(
    url,
    secret,
    coachId,
    now,
    end,
    "scheduled",
    "asc",
    30
  );
}

async function getOverdueSessions(
  url,
  secret,
  coachId
) {
  const h = dbHeaders(secret);

  const now =
    new Date().toISOString();

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&status=eq.scheduled&scheduled_at=lt.${encodeURIComponent(
      now
    )}&select=id,student_id,coach_id,package_id,scheduled_at,status&order=scheduled_at.asc&limit=30`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `OVERDUE:${await r.text()}`
    );
  }

  return await r.json();
}

/* =========================================================
   V6 STUDENT STATUS
   ========================================================= */

async function countCompletedSessions(
  url,
  secret,
  coachId,
  studentId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&student_id=eq.${encodeURIComponent(
      studentId
    )}&status=eq.completed&select=id`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `COUNT_COMPLETED:${await r.text()}`
    );
  }

  return (await r.json()).length;
}

async function getLastCompletedSession(
  url,
  secret,
  coachId,
  studentId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&student_id=eq.${encodeURIComponent(
      studentId
    )}&status=eq.completed&select=id,scheduled_at,status&order=scheduled_at.desc&limit=1`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `LAST_COMPLETED:${await r.text()}`
    );
  }

  return (await r.json())[0] || null;
}

async function getNextScheduledSession(
  url,
  secret,
  coachId,
  studentId
) {
  const h = dbHeaders(secret);

  const now =
    new Date().toISOString();

  const r = await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(
      coachId
    )}&student_id=eq.${encodeURIComponent(
      studentId
    )}&status=eq.scheduled&scheduled_at=gte.${encodeURIComponent(
      now
    )}&select=id,scheduled_at,status&order=scheduled_at.asc&limit=1`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `NEXT_SESSION:${await r.text()}`
    );
  }

  return (await r.json())[0] || null;
}

/* =========================================================
   TRAINING RECORDS
   ========================================================= */

function parseExerciseLine(line) {
  const clean = line.trim();

  if (!clean) return null;

  const m = clean.match(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*kg\s+(\d+)\s*[xX×*]\s*(\d+)(?:\s+RPE\s*(\d+(?:\.\d+)?))?$/i
  );

  if (!m) return null;

  return {
    exercise_name:
      m[1].trim(),
    weight_kg:
      Number(m[2]),
    reps:
      Number(m[3]),
    sets:
      Number(m[4]),
    rpe:
      m[5]
        ? Number(m[5])
        : null,
  };
}

async function saveExerciseRecords(
  url,
  secret,
  session,
  studentId,
  coachId,
  records
) {
  const h = dbHeaders(secret);

  const payload =
    records.map((r) => ({
      session_id: session.id,
      student_id: studentId,
      coach_id: coachId,
      exercise_name:
        r.exercise_name,
      weight_kg:
        r.weight_kg,
      reps:
        r.reps,
      sets:
        r.sets,
      rpe:
        r.rpe,
    }));

  const res = await fetch(
    `${url}/rest/v1/session_exercises`,
    {
      method: "POST",
      headers: {
        ...h,
        Prefer:
          "return=representation",
      },
      body:
        JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    throw new Error(
      `SAVE_EXERCISES:${await res.text()}`
    );
  }

  return await res.json();
}

async function getExercisesForSession(
  url,
  secret,
  sessionId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/session_exercises?session_id=eq.${encodeURIComponent(
      sessionId
    )}&select=exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `GET_EXERCISES:${await r.text()}`
    );
  }

  return await r.json();
}

async function getTrainingByDate(
  url,
  secret,
  studentId,
  coachId,
  dateText
) {
  const b =
    taiwanDayBounds(dateText);

  if (!b) return [];

  const sessions =
    await getSessionsBetween(
      url,
      secret,
      coachId,
      b.start,
      b.end,
      "active",
      "asc",
      30
    );

  const filtered =
    sessions.filter(
      (x) =>
        x.student_id ===
        studentId
    );

  const output = [];

  for (const session of filtered) {
    const exercises =
      await getExercisesForSession(
        url,
        secret,
        session.id
      );

    if (exercises.length) {
      output.push({
        ...session,
        exercises,
      });
    }
  }

  return output;
}

async function getRecentTraining(
  url,
  secret,
  studentId,
  coachId,
  limit = 5
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/sessions?student_id=eq.${encodeURIComponent(
      studentId
    )}&coach_id=eq.${encodeURIComponent(
      coachId
    )}&select=id,scheduled_at,status&order=scheduled_at.desc&limit=50`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `RECENT_SESSIONS:${await r.text()}`
    );
  }

  const sessions =
    await r.json();

  const result = [];

  for (const session of sessions) {
    const exercises =
      await getExercisesForSession(
        url,
        secret,
        session.id
      );

    if (exercises.length) {
      result.push({
        ...session,
        exercises,
      });
    }

    if (
      result.length >= limit
    ) {
      break;
    }
  }

  return result;
}

async function getExerciseHistory(
  url,
  secret,
  studentId,
  coachId,
  exerciseName
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/session_exercises?student_id=eq.${encodeURIComponent(
      studentId
    )}&coach_id=eq.${encodeURIComponent(
      coachId
    )}&exercise_name=ilike.${encodeURIComponent(
      `%${exerciseName}%`
    )}&select=session_id,exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `EXERCISE_HISTORY:${await r.text()}`
    );
  }

  const rows = await r.json();

  const output = [];

  for (const row of rows) {
    const s = await fetch(
      `${url}/rest/v1/sessions?id=eq.${encodeURIComponent(
        row.session_id
      )}&select=scheduled_at,status&limit=1`,
      { headers: h }
    );

    if (!s.ok) {
      throw new Error(
        `EXERCISE_SESSION:${await s.text()}`
      );
    }

    const session =
      (await s.json())[0];

    if (session) {
      output.push({
        ...row,
        scheduled_at:
          session.scheduled_at,
        session_status:
          session.status,
      });
    }
  }

  output.sort(
    (a, b) =>
      new Date(
        a.scheduled_at
      ) -
      new Date(
        b.scheduled_at
      )
  );

  return output;
}

async function getAllExerciseRecords(
  url,
  secret,
  studentId,
  coachId
) {
  const h = dbHeaders(secret);

  const r = await fetch(
    `${url}/rest/v1/session_exercises?student_id=eq.${encodeURIComponent(
      studentId
    )}&coach_id=eq.${encodeURIComponent(
      coachId
    )}&select=session_id,exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
    { headers: h }
  );

  if (!r.ok) {
    throw new Error(
      `ALL_EXERCISES:${await r.text()}`
    );
  }

  const rows = await r.json();

  const result = [];

  for (const row of rows) {
    const s = await fetch(
      `${url}/rest/v1/sessions?id=eq.${encodeURIComponent(
        row.session_id
      )}&select=scheduled_at,status&limit=1`,
      { headers: h }
    );

    if (!s.ok) {
      throw new Error(
        `SUMMARY_SESSION:${await s.text()}`
      );
    }

    const session =
      (await s.json())[0];

    if (session) {
      result.push({
        ...row,
        scheduled_at:
          session.scheduled_at,
        session_status:
          session.status,
      });
    }
  }

  result.sort(
    (a, b) =>
      new Date(
        a.scheduled_at
      ) -
      new Date(
        b.scheduled_at
      )
  );

  return result;
}

/* =========================================================
   TRAINING ANALYSIS
   ========================================================= */

function trainingVolume(record) {
  const weight =
    Number(record.weight_kg);

  const reps =
    Number(record.reps);

  const sets =
    Number(record.sets);

  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(reps) ||
    !Number.isFinite(sets)
  ) {
    return null;
  }

  return (
    weight *
    reps *
    sets
  );
}

function estimated1RM(record) {
  const weight =
    Number(record.weight_kg);

  const reps =
    Number(record.reps);

  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(reps) ||
    weight <= 0 ||
    reps <= 0
  ) {
    return null;
  }

  if (reps > 15) {
    return null;
  }

  return (
    weight *
    (1 + reps / 30)
  );
}

function percentChange(before, after) {
  if (
    before == null ||
    after == null ||
    Number(before) === 0
  ) {
    return null;
  }

  return (
    ((Number(after) -
      Number(before)) /
      Number(before)) *
    100
  );
}

function formatNumber(
  value,
  digits = 1
) {
  if (
    value == null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "—";
  }

  const n = Number(value);

  return Number.isInteger(n)
    ? String(n)
    : n.toFixed(digits);
}

function formatSignedPercent(value) {
  if (
    value == null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "—";
  }

  const n = Number(value);

  return `${
    n > 0 ? "+" : ""
  }${n.toFixed(1)}%`;
}

function formatExercise(r) {
  return `・${r.exercise_name}｜${formatNumber(
    r.weight_kg
  )}kg｜${r.reps}下×${r.sets}組${
    r.rpe != null
      ? `｜RPE ${formatNumber(
          r.rpe
        )}`
      : ""
  }`;
}

function analyseExerciseProgress(records) {
  if (!records.length) {
    return null;
  }

  const first =
    records[0];

  const last =
    records[
      records.length - 1
    ];

  const firstWeight =
    Number(
      first.weight_kg
    );

  const lastWeight =
    Number(
      last.weight_kg
    );

  const firstVolume =
    trainingVolume(first);

  const lastVolume =
    trainingVolume(last);

  const first1RM =
    estimated1RM(first);

  const last1RM =
    estimated1RM(last);

  return {
    count:
      records.length,

    first,
    last,

    weightPct:
      percentChange(
        firstWeight,
        lastWeight
      ),

    firstVolume,
    lastVolume,

    volumePct:
      percentChange(
        firstVolume,
        lastVolume
      ),

    first1RM,
    last1RM,

    rmPct:
      percentChange(
        first1RM,
        last1RM
      ),
  };
}

/* =========================================================
   HELP
   ========================================================= */

function help() {
  return [
    "Chilling Coach Bot V6 Complete",
    "",
    "【基本】",
    "・我的權限",
    "・我的學員",
    "・我的摘要",
    "",
    "【課程工作台】",
    "・今日課表",
    "・明日課表",
    "・8/15 課表",
    "・近期預約",
    "・待完成課程",
    "・今日摘要",
    "",
    "【學員】",
    "・王小明 狀態",
    "・王小明剩幾堂",
    "",
    "【預約／完成】",
    "・8/15 15:00 王小明 預約上課",
    "・王小明 完成上課",
    "・王小明 8/15 完成上課",
    "",
    "【訓練紀錄】",
    "・王小明 上次訓練",
    "・王小明 最近訓練",
    "・王小明 8/15 訓練紀錄",
    "・王小明 Back squat 紀錄",
    "",
    "【訓練分析】",
    "・王小明 Back squat 進步多少",
    "・王小明 訓練摘要",
    "",
    "【新增訓練紀錄】",
    "王小明 8/15",
    "Back squat 30kg 10*3",
    "Bench press 20kg 12*3 RPE8",
  ].join("\n");
}

/* =========================================================
   COMMAND HANDLER
   ========================================================= */

async function handleCommand(
  text,
  user,
  url,
  secret
) {
  const s =
    text.trim();

  /* -------------------------
     HELP
     ------------------------- */

  if (
    /^(幫助|help|說明|指令)$/i.test(
      s
    )
  ) {
    return help();
  }

  /* -------------------------
     ROLE
     ------------------------- */

  if (
    /^(我的權限|權限)$/i.test(
      s
    )
  ) {
    return `你的系統權限：${
      user.roles.length
        ? user.roles.join(
            " + "
          )
        : "尚未指派"
    }`;
  }

  /* -------------------------
     STUDENT LIST
     ------------------------- */

  if (
    /^(我的學員|學員名單)$/i.test(
      s
    )
  ) {
    const list =
      await getStudents(
        url,
        secret,
        user.id
      );

    if (!list.length) {
      return "你目前沒有綁定中的學員。";
    }

    return (
      `目前共 ${list.length} 位學員：\n` +
      list
        .map(
          (x, i) =>
            `${i + 1}. ${x.name}`
        )
        .join("\n")
    );
  }

  /* =====================================================
     V6 — TODAY SCHEDULE
     ===================================================== */

  if (
    /^(今日課表|今天課表|我今天的課)$/i.test(
      s
    )
  ) {
    const bounds =
      taiwanBoundsOffset(0);

    const sessions =
      await getSessionsBetween(
        url,
        secret,
        user.id,
        bounds.start,
        bounds.end,
        "active"
      );

    return await renderSchedule(
      url,
      secret,
      user.id,
      sessions,
      "📅 今日課表"
    );
  }

  /* =====================================================
     V6 — TOMORROW SCHEDULE
     ===================================================== */

  if (
    /^(明日課表|明天課表)$/i.test(
      s
    )
  ) {
    const bounds =
      taiwanBoundsOffset(1);

    const sessions =
      await getSessionsBetween(
        url,
        secret,
        user.id,
        bounds.start,
        bounds.end,
        "active"
      );

    return await renderSchedule(
      url,
      secret,
      user.id,
      sessions,
      "📅 明日課表"
    );
  }

  /* =====================================================
     V6 — SPECIFIC DATE SCHEDULE
     ===================================================== */

  const dateSchedule =
    s.match(
      /^(\d{1,2}\/\d{1,2})\s+課表$/
    );

  if (dateSchedule) {
    const bounds =
      taiwanDayBounds(
        dateSchedule[1]
      );

    if (!bounds) {
      return "日期格式無法辨識，例如：8/15 課表";
    }

    const sessions =
      await getSessionsBetween(
        url,
        secret,
        user.id,
        bounds.start,
        bounds.end,
        "active"
      );

    return await renderSchedule(
      url,
      secret,
      user.id,
      sessions,
      `📅 ${dateSchedule[1]} 課表`
    );
  }

  /* =====================================================
     V6 — UPCOMING BOOKINGS
     ===================================================== */

  if (
    /^(近期預約|未來預約|接下來的課)$/i.test(
      s
    )
  ) {
    const sessions =
      await getUpcomingBookings(
        url,
        secret,
        user.id,
        7
      );

    if (!sessions.length) {
      return "📆 近期預約\n\n未來 7 天目前沒有預約課程。";
    }

    const students =
      await getStudents(
        url,
        secret,
        user.id
      );

    const map =
      buildStudentMap(students);

    const lines =
      sessions.map(
        (session) => {
          const name =
            map.get(
              session.student_id
            )?.name ||
            "未知學員";

          return `${formatTaiwanDateTime(
            session.scheduled_at
          )}｜${name}`;
        }
      );

    return `📆 近期預約｜未來7天

${lines.join("\n")}`;
  }

  /* =====================================================
     V6 — OVERDUE
     ===================================================== */

  if (
    /^(待完成課程|待完成|未完成課程)$/i.test(
      s
    )
  ) {
    const sessions =
      await getOverdueSessions(
        url,
        secret,
        user.id
      );

    if (!sessions.length) {
      return "✅ 目前沒有逾時待完成課程。";
    }

    const students =
      await getStudents(
        url,
        secret,
        user.id
      );

    const map =
      buildStudentMap(students);

    const lines =
      sessions.map(
        (session) => {
          const name =
            map.get(
              session.student_id
            )?.name ||
            "未知學員";

          return `⚠️ ${formatTaiwanDateTime(
            session.scheduled_at
          )}｜${name}`;
        }
      );

    return `⚠️ 待完成課程｜${sessions.length}堂

${lines.join("\n")}

完成後可輸入：
「學員姓名 日期 完成上課」`;
  }

  /* =====================================================
     V6 — TODAY SUMMARY
     ===================================================== */

  if (
    /^(今日摘要|今天摘要|今日工作)$/i.test(
      s
    )
  ) {
    const bounds =
      taiwanBoundsOffset(0);

    const sessions =
      await getSessionsBetween(
        url,
        secret,
        user.id,
        bounds.start,
        bounds.end,
        "active"
      );

    const now =
      new Date();

    const completed =
      sessions.filter(
        (x) =>
          x.status ===
          "completed"
      ).length;

    const overdue =
      sessions.filter(
        (x) =>
          x.status ===
            "scheduled" &&
          new Date(
            x.scheduled_at
          ) < now
      ).length;

    const upcoming =
      sessions.filter(
        (x) =>
          x.status ===
            "scheduled" &&
          new Date(
            x.scheduled_at
          ) >= now
      ).length;

    const students =
      await getStudents(
        url,
        secret,
        user.id
      );

    const map =
      buildStudentMap(students);

    const names = [
      ...new Set(
        sessions
          .map(
            (x) =>
              map.get(
                x.student_id
              )?.name
          )
          .filter(Boolean)
      ),
    ];

    return `📊 今日工作摘要

今日課程：${sessions.length}堂
✅ 已完成：${completed}堂
⚠️ 待完成：${overdue}堂
🗓 尚未開始：${upcoming}堂

今日學員：
${
  names.length
    ? names
        .map(
          (x) => `・${x}`
        )
        .join("\n")
    : "目前沒有課程"
}`;
  }

  /* =====================================================
     V6 — MY DASHBOARD
     ===================================================== */

  if (
    /^(我的摘要|我的工作|教練摘要|工作摘要)$/i.test(
      s
    )
  ) {
    const students =
      await getStudents(
        url,
        secret,
        user.id
      );

    const todayBounds =
      taiwanBoundsOffset(0);

    const today =
      await getSessionsBetween(
        url,
        secret,
        user.id,
        todayBounds.start,
        todayBounds.end,
        "active"
      );

    const overdue =
      await getOverdueSessions(
        url,
        secret,
        user.id
      );

    const upcoming =
      await getUpcomingBookings(
        url,
        secret,
        user.id,
        7
      );

    const completedToday =
      today.filter(
        (x) =>
          x.status ===
          "completed"
      ).length;

    const next =
      upcoming[0] || null;

    let nextText =
      "目前沒有近期預約";

    if (next) {
      const map =
        buildStudentMap(
          students
        );

      const name =
        map.get(
          next.student_id
        )?.name ||
        "未知學員";

      nextText =
        `${formatTaiwanDateTime(
          next.scheduled_at
        )}｜${name}`;
    }

    return `🧭 我的工作摘要

管理學員：${students.length}人

今日課程：${today.length}堂
今日已完成：${completedToday}堂

未來7天預約：${upcoming.length}堂
逾時待完成：${overdue.length}堂

下一堂：
${nextText}`;
  }

  /* =====================================================
     V6 — STUDENT STATUS
     ===================================================== */

  const studentStatus =
    s.match(
      /^(.+?)\s+(?:狀態|學員狀態|目前狀態)$/
    );

  if (studentStatus) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        studentStatus[1]
      );

    if (
      found.status ===
      "not_found"
    ) {
      return `找不到你的學員「${studentStatus[1].trim()}」。`;
    }

    if (
      found.status ===
      "multiple"
    ) {
      return "找到多位符合的學員，請輸入完整姓名。";
    }

    const pkg =
      await getLatestPackage(
        url,
        secret,
        found.student.id
      );

    const completed =
      await countCompletedSessions(
        url,
        secret,
        user.id,
        found.student.id
      );

    const last =
      await getLastCompletedSession(
        url,
        secret,
        user.id,
        found.student.id
      );

    const next =
      await getNextScheduledSession(
        url,
        secret,
        user.id,
        found.student.id
      );

    const recent =
      await getRecentTraining(
        url,
        secret,
        found.student.id,
        user.id,
        1
      );

    let trainingText =
      "尚無訓練紀錄";

    if (recent.length) {
      trainingText =
        `${formatTaiwanDate(
          recent[0]
            .scheduled_at
        )}\n` +
        recent[0].exercises
          .slice(0, 4)
          .map(formatExercise)
          .join("\n");
    }

    return `👤 ${found.student.name}｜學員狀態

方案：${
      pkg?.package_name ||
      "目前無方案"
    }

剩餘：${
      pkg
        ? `${pkg.remaining_sessions} / ${pkg.purchased_sessions}堂`
        : "—"
    }

累積完成：${completed}堂

上次上課：
${
  last
    ? formatTaiwanDateTime(
        last.scheduled_at
      )
    : "尚無完成課程"
}

下次預約：
${
  next
    ? formatTaiwanDateTime(
        next.scheduled_at
      )
    : "目前沒有預約"
}

最近訓練：
${trainingText}`;
  }

  /* =====================================================
     V5H — TRAINING SUMMARY
     ===================================================== */

  const trainingSummary =
    s.match(
      /^(.+?)\s+(?:訓練摘要|訓練分析|訓練狀況)$/
    );

  if (trainingSummary) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        trainingSummary[1]
      );

    if (
      found.status ===
      "not_found"
    ) {
      return `找不到你的學員「${trainingSummary[1].trim()}」。`;
    }

    if (
      found.status ===
      "multiple"
    ) {
      return "找到多位符合的學員，請輸入完整姓名。";
    }

    const all =
      await getAllExerciseRecords(
        url,
        secret,
        found.student.id,
        user.id
      );

    if (!all.length) {
      return `${found.student.name} 目前沒有訓練紀錄。`;
    }

    const sessionIds =
      new Set(
        all.map(
          (r) =>
            r.session_id
        )
      );

    const exerciseMap =
      new Map();

    for (const record of all) {
      const key =
        record.exercise_name
          .trim()
          .toLowerCase();

      if (
        !exerciseMap.has(key)
      ) {
        exerciseMap.set(
          key,
          []
        );
      }

      exerciseMap
        .get(key)
        .push(record);
    }

    const ranked = [
      ...exerciseMap.entries(),
    ]
      .sort(
        (a, b) =>
          b[1].length -
          a[1].length
      )
      .slice(0, 5);

    const blocks =
      ranked.map(
        ([, records]) => {
          const analysis =
            analyseExerciseProgress(
              records
            );

          const name =
            analysis.last
              .exercise_name;

          if (
            analysis.count <
            2
          ) {
            return `🏋️ ${name}
目前 ${analysis.count} 次紀錄
最新：${formatNumber(
              analysis.last
                .weight_kg
            )}kg × ${
              analysis.last
                .reps
            }`;
          }

          let line =
            `🏋️ ${name}\n`;

          line +=
            `重量：${formatNumber(
              analysis.first
                .weight_kg
            )} → ${formatNumber(
              analysis.last
                .weight_kg
            )}kg（${formatSignedPercent(
              analysis.weightPct
            )}）`;

          if (
            analysis.first1RM !=
              null &&
            analysis.last1RM !=
              null
          ) {
            line +=
              `\n估算1RM：${formatNumber(
                analysis.first1RM
              )} → ${formatNumber(
                analysis.last1RM
              )}kg`;
          }

          return line;
        }
      );

    const recent =
      await getRecentTraining(
        url,
        secret,
        found.student.id,
        user.id,
        1
      );

    const lastDate =
      recent.length
        ? formatTaiwanDate(
            recent[0]
              .scheduled_at
          )
        : "—";

    let latestText =
      "";

    if (recent.length) {
      latestText =
        `\n\n最近一次 ${lastDate}\n` +
        recent[0].exercises
          .map(formatExercise)
          .join("\n");
    }

    return `📊 ${found.student.name}｜訓練摘要

已記錄課程：${sessionIds.size}次
最近訓練：${lastDate}
已記錄動作：${exerciseMap.size}種

${blocks.join(
  "\n\n"
)}${latestText}`;
  }

  /* =====================================================
     V5G — PROGRESS
     ===================================================== */

  const progress =
    s.match(
      /^(.+?)\s+(.+?)\s+(?:進步多少|進步分析|進步)$/
    );

  if (progress) {
    const studentName =
      progress[1].trim();

    const exerciseName =
      progress[2].trim();

    const found =
      await findStudent(
        url,
        secret,
        user.id,
        studentName
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const records =
      await getExerciseHistory(
        url,
        secret,
        found.student.id,
        user.id,
        exerciseName
      );

    if (!records.length) {
      return `${found.student.name} 找不到「${exerciseName}」的訓練紀錄。`;
    }

    if (
      records.length < 2
    ) {
      return `📈 ${found.student.name}｜${records[0].exercise_name}

目前只有 1 次訓練紀錄，至少需要 2 次紀錄才能進行進步比較。

目前紀錄：
${formatTaiwanDate(
  records[0]
    .scheduled_at
)}｜${formatNumber(
        records[0]
          .weight_kg
      )}kg｜${
        records[0].reps
      }下×${
        records[0].sets
      }組`;
    }

    const analysis =
      analyseExerciseProgress(
        records
      );

    const first =
      analysis.first;

    const last =
      analysis.last;

    const output = [
      `📈 ${found.student.name}｜${last.exercise_name} 進步分析`,
      "",
      `紀錄次數：${analysis.count}次`,
      `期間：${formatTaiwanDate(
        first.scheduled_at
      )} → ${formatTaiwanDate(
        last.scheduled_at
      )}`,
      "",
      `第一次：${formatNumber(
        first.weight_kg
      )}kg × ${first.reps}下 × ${first.sets}組`,
      `最近一次：${formatNumber(
        last.weight_kg
      )}kg × ${last.reps}下 × ${last.sets}組`,
      "",
      `重量：${formatNumber(
        first.weight_kg
      )} → ${formatNumber(
        last.weight_kg
      )}kg（${formatSignedPercent(
        analysis.weightPct
      )}）`,
    ];

    if (
      analysis.firstVolume !=
        null &&
      analysis.lastVolume !=
        null
    ) {
      output.push(
        `Volume：${formatNumber(
          analysis.firstVolume
        )} → ${formatNumber(
          analysis.lastVolume
        )}kg（${formatSignedPercent(
          analysis.volumePct
        )}）`
      );
    }

    if (
      analysis.first1RM !=
        null &&
      analysis.last1RM !=
        null
    ) {
      output.push(
        `估算1RM：${formatNumber(
          analysis.first1RM
        )} → ${formatNumber(
          analysis.last1RM
        )}kg（${formatSignedPercent(
          analysis.rmPct
        )}）`
      );
    }

    output.push(
      "",
      "※ Volume＝重量×次數×組數；估算1RM採 Epley 公式，僅作趨勢參考。"
    );

    return output.join("\n");
  }

  /* =====================================================
     RECENT TRAINING
     ===================================================== */

  const recent =
    s.match(
      /^(.+?)\s+(?:最近訓練|最近訓練紀錄|上次訓練)$/
    );

  if (recent) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        recent[1]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const requestedLast =
      /上次訓練$/.test(
        s
      );

    const sessions =
      await getRecentTraining(
        url,
        secret,
        found.student.id,
        user.id,
        requestedLast
          ? 1
          : 5
      );

    if (!sessions.length) {
      return `${found.student.name} 目前沒有訓練紀錄。`;
    }

    if (requestedLast) {
      return `📋 ${found.student.name} 上次訓練
日期：${formatTaiwanDate(
        sessions[0]
          .scheduled_at
      )}

${sessions[0].exercises
  .map(formatExercise)
  .join("\n")}`;
    }

    const blocks =
      sessions.map(
        (session) =>
          `${formatTaiwanDate(
            session.scheduled_at
          )}
${session.exercises
  .map(formatExercise)
  .join("\n")}`
      );

    return `📋 ${found.student.name}｜最近訓練

${blocks.join("\n\n")}`;
  }

  /* =====================================================
     DATE TRAINING
     ===================================================== */

  const datedTraining =
    s.match(
      /^(.+?)\s+(\d{1,2}\/\d{1,2})\s+(?:訓練紀錄|訓練)$/
    );

  if (datedTraining) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        datedTraining[1]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const sessions =
      await getTrainingByDate(
        url,
        secret,
        found.student.id,
        user.id,
        datedTraining[2]
      );

    if (!sessions.length) {
      return `${found.student.name} ${datedTraining[2]} 找不到訓練紀錄。`;
    }

    const blocks =
      sessions.map(
        (session) =>
          session.exercises
            .map(formatExercise)
            .join("\n")
      );

    return `📋 ${found.student.name} ${datedTraining[2]} 訓練紀錄

${blocks.join("\n\n")}`;
  }

  /* =====================================================
     EXERCISE HISTORY
     ===================================================== */

  const exerciseHistory =
    s.match(
      /^(.+?)\s+(.+?)\s+(?:紀錄|歷史)$/
    );

  if (exerciseHistory) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        exerciseHistory[1]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const records =
      await getExerciseHistory(
        url,
        secret,
        found.student.id,
        user.id,
        exerciseHistory[2]
      );

    if (!records.length) {
      return `${found.student.name} 找不到「${exerciseHistory[2]}」的訓練紀錄。`;
    }

    const lines =
      records.map(
        (r) =>
          `${formatTaiwanDate(
            r.scheduled_at
          )}｜${formatNumber(
            r.weight_kg
          )}kg｜${r.reps}下×${r.sets}組${
            r.rpe != null
              ? `｜RPE ${formatNumber(
                  r.rpe
                )}`
              : ""
          }`
      );

    let change =
      "\n\n目前只有 1 次紀錄，尚無法判斷進步趨勢。";

    if (
      records.length >= 2
    ) {
      const analysis =
        analyseExerciseProgress(
          records
        );

      change =
        `\n\n重量變化：${formatNumber(
          analysis.first
            .weight_kg
        )} → ${formatNumber(
          analysis.last
            .weight_kg
        )}kg（${formatSignedPercent(
          analysis.weightPct
        )}）`;

      if (
        analysis.first1RM !=
          null &&
        analysis.last1RM !=
          null
      ) {
        change +=
          `\n估算1RM：${formatNumber(
            analysis.first1RM
          )} → ${formatNumber(
            analysis.last1RM
          )}kg`;
      }
    }

    return `📈 ${found.student.name}｜${records[0].exercise_name}

${lines.join("\n")}${change}`;
  }

  /* =====================================================
     REMAINING
     ===================================================== */

  const remain =
    s.match(
      /^(.+?)\s*剩(?:餘)?(?:幾|多少)堂[？?]?$/
    );

  if (remain) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        remain[1]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const pkg =
      await getLatestPackage(
        url,
        secret,
        found.student.id
      );

    if (!pkg) {
      return `${found.student.name}
目前沒有課程方案。`;
    }

    return `${found.student.name}
方案：${
      pkg.package_name ||
      `${pkg.purchased_sessions}堂方案`
    }
剩餘：${pkg.remaining_sessions}堂${
      pkg.expires_at
        ? `\n有效至：${pkg.expires_at}`
        : ""
    }`;
  }

  /* =====================================================
     BOOKING
     ===================================================== */

  const booking =
    s.match(
      /^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+(.+?)\s*(?:預約上課|預約|上課預約)$/
    );

  if (booking) {
    const when =
      parseMonthDay(
        booking[1],
        booking[2]
      );

    if (!when) {
      return "日期或時間無法辨識。";
    }

    const found =
      await findStudent(
        url,
        secret,
        user.id,
        booking[3]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const pkg =
      await getActivePackage(
        url,
        secret,
        found.student.id
      );

    if (!pkg) {
      return `${found.student.name}目前沒有有效中的課程方案。`;
    }

    const created =
      await createBooking(
        url,
        secret,
        user.id,
        found.student.id,
        pkg.id,
        when
      );

    if (
      created.status ===
      "collision"
    ) {
      return `⚠️ ${booking[1]} ${booking[2]} 你已經有其他預約。`;
    }

    return `✅ 已預約 ${found.student.name}
時間：${booking[1]} ${booking[2]}
方案：${
      pkg.package_name ||
      `${pkg.purchased_sessions}堂方案`
    }
剩餘：${pkg.remaining_sessions}堂

※ 預約不先扣堂，完成上課才扣除。`;
  }

  /* =====================================================
     COMPLETE
     ===================================================== */

  const complete =
    s.match(
      /^(.+?)(?:\s+(\d{1,2}\/\d{1,2}))?\s+完成上課$/
    );

  if (complete) {
    const found =
      await findStudent(
        url,
        secret,
        user.id,
        complete[1]
      );

    if (
      found.status !==
      "ok"
    ) {
      return "找不到唯一符合的學員，請輸入完整姓名。";
    }

    const result =
      await findScheduledSession(
        url,
        secret,
        user.id,
        found.student.id,
        complete[2] || null
      );

    if (
      result.status ===
      "none"
    ) {
      return `${found.student.name} 找不到可完成的預約課程。`;
    }

    if (
      result.status ===
      "multiple"
    ) {
      return `${found.student.name} 找到多堂未完成課程，請指定日期。`;
    }

    const done =
      await completeSession(
        url,
        secret,
        result.session.id,
        user.id
      );

    return `✅ 已完成 ${found.student.name} 本次課程
已扣除 1 堂
剩餘：${done.remaining_sessions}堂`;
  }

  /* =====================================================
     ADD TRAINING RECORD
     ===================================================== */

  const lines =
    s
      .split(/\r?\n/)
      .map(
        (x) => x.trim()
      )
      .filter(Boolean);

  if (
    lines.length >= 2
  ) {
    const head =
      lines[0].match(
        /^(.+?)\s+(\d{1,2}\/\d{1,2})$/
      );

    if (head) {
      const found =
        await findStudent(
          url,
          secret,
          user.id,
          head[1]
        );

      if (
        found.status !==
        "ok"
      ) {
        return "找不到唯一符合的學員，請輸入完整姓名。";
      }

      const records = [];
      const failed = [];

      for (
        const line of lines.slice(
          1
        )
      ) {
        const parsed =
          parseExerciseLine(
            line
          );

        if (parsed) {
          records.push(parsed);
        } else {
          failed.push(line);
        }
      }

      if (!records.length) {
        return `目前無法辨識訓練紀錄格式。

例如：
Back squat 30kg 10*3`;
      }

      const sessionResult =
        await findTrainingSession(
          url,
          secret,
          user.id,
          found.student.id,
          head[2]
        );

      if (
        sessionResult.status ===
        "none"
      ) {
        return `${found.student.name} ${head[2]} 找不到課程，請先建立預約。`;
      }

      if (
        sessionResult.status ===
        "multiple"
      ) {
        return `${found.student.name} ${head[2]} 有多堂課，目前請先在 MINI App 選擇正確課程。`;
      }

      await saveExerciseRecords(
        url,
        secret,
        sessionResult.session,
        found.student.id,
        user.id,
        records
      );

      const summary =
        records
          .map(formatExercise)
          .join("\n");

      const warn =
        failed.length
          ? `

⚠️ 未辨識：
${failed.join("\n")}`
          : "";

      return `✅ 已記錄 ${found.student.name} ${head[2]} 訓練內容

${summary}${warn}

對應：${
        sessionResult.session
          .status ===
        "completed"
          ? "已完成課程"
          : "已預約課程"
      }`;
    }
  }

  return `目前還無法辨識這個指令。
輸入「幫助」查看可用格式。`;
}

/* =========================================================
   POST
   ========================================================= */

export async function POST(request) {
  const channelSecret =
    process.env.LINE_CHANNEL_SECRET;

  const channelToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const dbUrl =
    process.env.SUPABASE_URL;

  const dbSecret =
    process.env.SUPABASE_SECRET_KEY;

  if (
    !channelSecret ||
    !channelToken ||
    !dbUrl ||
    !dbSecret
  ) {
    return json(
      {
        error:
          "Server environment is not configured",
      },
      500
    );
  }

  const raw =
    await request.text();

  if (
    !verifySignature(
      raw,
      request.headers.get(
        "x-line-signature"
      ),
      channelSecret
    )
  ) {
    return json(
      {
        error:
          "Invalid LINE signature",
      },
      401
    );
  }

  let body;

  try {
    body =
      JSON.parse(raw);
  } catch {
    return json(
      {
        error:
          "Invalid JSON",
      },
      400
    );
  }

  if (
    !body.events?.length
  ) {
    return json({
      ok: true,
    });
  }

  for (
    const event of body.events
  ) {
    if (
      event.type !==
        "message" ||
      event.message?.type !==
        "text" ||
      !event.replyToken
    ) {
      continue;
    }

    try {
      const lineUserId =
        event.source?.userId;

      if (!lineUserId) {
        await lineReply(
          event.replyToken,
          "目前只支援一對一文字訊息。",
          channelToken
        );

        continue;
      }

      const user =
        await getUser(
          dbUrl,
          dbSecret,
          lineUserId
        );

      if (!user) {
        await lineReply(
          event.replyToken,
          "你的帳號尚未完成 Chilling Coach OS 註冊，請先開啟 MINI App 登入。",
          channelToken
        );

        continue;
      }

      if (
        !user.roles.includes(
          "coach"
        )
      ) {
        await lineReply(
          event.replyToken,
          "你的帳號目前沒有教練權限。",
          channelToken
        );

        continue;
      }

      const out =
        await handleCommand(
          event.message.text,
          user,
          dbUrl,
          dbSecret
        );

      await lineReply(
        event.replyToken,
        out,
        channelToken
      );
    } catch (err) {
      console.error(err);

      try {
        await lineReply(
          event.replyToken,
          "系統處理這則訊息時發生錯誤，請稍後再試。",
          channelToken
        );
      } catch {}
    }
  }

  return json({
    ok: true,
  });
}

/* =========================================================
   GET
   ========================================================= */

export async function GET() {
  return json({
    service:
      "Chilling Coach OS LINE Webhook",
    version:
      "V6 Complete",
    status:
      "ready",
  });
}
