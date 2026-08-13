
async function getLineProfile(accessToken) {
  const lineResp = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!lineResp.ok) {
    const err = new Error("Invalid or expired LINE access token");
    err.statusCode = 401;
    throw err;
  }
  return await lineResp.json();
}

async function getSystemUser(supabaseUrl, supabaseSecret, lineUserId) {
  const headers = {
    apikey: supabaseSecret,
    Authorization: `Bearer ${supabaseSecret}`,
    "Content-Type": "application/json"
  };

  const resp = await fetch(
    `${supabaseUrl}/rest/v1/users?line_user_id=eq.${encodeURIComponent(lineUserId)}&is_active=eq.true&select=id,display_name`,
    { headers }
  );

  if (!resp.ok) throw new Error("Unable to read system user");
  const rows = await resp.json();
  if (!rows[0]) {
    const err = new Error("System account not found");
    err.statusCode = 403;
    throw err;
  }
  return { user: rows[0], headers };
}

async function requireCoach(supabaseUrl, headers, userId) {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}&role=eq.coach&select=role`,
    { headers }
  );
  if (!resp.ok) throw new Error("Unable to check coach role");
  const rows = await resp.json();
  if (!rows.length) {
    const err = new Error("Coach role required");
    err.statusCode = 403;
    throw err;
  }
}

module.exports = async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecret) {
      return res.status(500).json({ error: "Server environment is not configured" });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!accessToken) {
      return res.status(401).json({ error: "Missing LINE access token" });
    }

    const lineProfile = await getLineProfile(accessToken);
    const { user, headers } = await getSystemUser(
      supabaseUrl,
      supabaseSecret,
      lineProfile.userId
    );

    await requireCoach(supabaseUrl, headers, user.id);

    if (req.method === "GET") {
      const relationResp = await fetch(
        `${supabaseUrl}/rest/v1/coach_students?coach_id=eq.${encodeURIComponent(user.id)}&ended_at=is.null&select=student_id,is_primary,started_at`,
        { headers }
      );

      if (!relationResp.ok) {
        throw new Error("Unable to load coach-student relations");
      }

      const relations = await relationResp.json();
      const ids = [...new Set(relations.map(r => r.student_id).filter(Boolean))];

      if (!ids.length) {
        return res.status(200).json({ students: [] });
      }

      const inFilter = ids.map(id => `"${id}"`).join(",");
      const studentsResp = await fetch(
        `${supabaseUrl}/rest/v1/students?id=in.(${encodeURIComponent(inFilter)})&select=id,name,phone,status,joined_at,note,created_at&order=created_at.desc`,
        { headers }
      );

      if (!studentsResp.ok) {
        const detail = await studentsResp.text();
        throw new Error(`Unable to load students: ${detail}`);
      }

      const students = await studentsResp.json();
      return res.status(200).json({ students });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const normalizedPhone = phone.replace(/[^0-9]/g, "");
      const note = String(body.note || "").trim();

      if (!name || !phone) {
        return res.status(400).json({ error: "Student name and phone are required" });
      }
      if (normalizedPhone.length < 8 || normalizedPhone.length > 15) {
        return res.status(400).json({ error: "Invalid phone number" });
      }
      if (name.length > 50 || phone.length > 30 || note.length > 500) {
        return res.status(400).json({ error: "Input is too long" });
      }

      const duplicateResp = await fetch(
        `${supabaseUrl}/rest/v1/students?normalized_phone=eq.${encodeURIComponent(normalizedPhone)}&select=id,name,phone&limit=1`,
        { headers }
      );
      if (!duplicateResp.ok) throw new Error("Unable to check duplicate phone");
      const duplicateRows = await duplicateResp.json();
      if (duplicateRows[0]) {
        return res.status(409).json({ error: `Phone already belongs to ${duplicateRows[0].name}`, existingStudentId: duplicateRows[0].id });
      }

      const createStudentResp = await fetch(
        `${supabaseUrl}/rest/v1/students`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            name,
            phone: phone || null,
            note: note || null,
            status: "active"
          })
        }
      );

      if (!createStudentResp.ok) {
        const detail = await createStudentResp.text();
        throw new Error(`Unable to create student: ${detail}`);
      }

      const createdRows = await createStudentResp.json();
      const student = createdRows[0];

      const linkResp = await fetch(
        `${supabaseUrl}/rest/v1/coach_students`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            coach_id: user.id,
            student_id: student.id,
            is_primary: true
          })
        }
      );

      if (!linkResp.ok) {
        // Best-effort rollback so an unassigned orphan student is not left behind.
        await fetch(
          `${supabaseUrl}/rest/v1/students?id=eq.${encodeURIComponent(student.id)}`,
          { method: "DELETE", headers }
        );
        const detail = await linkResp.text();
        throw new Error(`Unable to assign coach: ${detail}`);
      }

      return res.status(201).json({ student });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Internal server error"
    });
  }
};
