
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { accessToken } = req.body || {};
    if (!accessToken || typeof accessToken !== "string") {
      return res.status(400).json({ error: "Missing LINE access token" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecret) {
      return res.status(500).json({ error: "Server environment is not configured" });
    }

    // Validate the token with LINE and obtain the user identity from LINE itself.
    const lineResp = await fetch("https://api.line.me/v2/profile", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!lineResp.ok) {
      return res.status(401).json({ error: "Invalid or expired LINE access token" });
    }

    const lineProfile = await lineResp.json();
    const lineUserId = lineProfile.userId;
    const displayName = lineProfile.displayName || "LINE User";

    if (!lineUserId) {
      return res.status(401).json({ error: "LINE user ID not available" });
    }

    const headers = {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      "Content-Type": "application/json"
    };

    // Find existing system user
    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/users?line_user_id=eq.${encodeURIComponent(lineUserId)}&select=id,line_user_id,display_name,is_active`,
      { headers }
    );

    if (!lookup.ok) {
      const detail = await lookup.text();
      throw new Error(`Supabase lookup failed: ${detail}`);
    }

    let users = await lookup.json();
    let user = users[0];
    let created = false;

    if (!user) {
      const createResp = await fetch(
        `${supabaseUrl}/rest/v1/users`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            line_user_id: lineUserId,
            display_name: displayName,
            is_active: true
          })
        }
      );

      if (!createResp.ok) {
        const detail = await createResp.text();
        throw new Error(`Supabase user creation failed: ${detail}`);
      }

      const createdRows = await createResp.json();
      user = createdRows[0];
      created = true;
    } else if (user.display_name !== displayName) {
      // Keep display name synced with LINE.
      const updateResp = await fetch(
        `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            display_name: displayName,
            updated_at: new Date().toISOString()
          })
        }
      );

      if (updateResp.ok) {
        const updatedRows = await updateResp.json();
        if (updatedRows[0]) user = updatedRows[0];
      }
    }

    // Get roles
    const rolesResp = await fetch(
      `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role`,
      { headers }
    );

    if (!rolesResp.ok) {
      const detail = await rolesResp.text();
      throw new Error(`Supabase role lookup failed: ${detail}`);
    }

    const roleRows = await rolesResp.json();
    const roles = roleRows.map(r => r.role);

    return res.status(200).json({
      created,
      user: {
        id: user.id,
        displayName: user.display_name,
        isActive: user.is_active
      },
      roles
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
