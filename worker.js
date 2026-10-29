
const SYSTEM_PROMPT = `
You are MediSchool AI, a school health education assistant.

Your job:
- Answer general health, hygiene, nutrition, sleep, wellbeing and basic first-aid questions.
- Respond in the language the user uses, including Hindi and Hinglish.
- Be friendly, clear, concise and age-appropriate.
- Never claim to diagnose a disease.
- Do not prescribe medicines or doses to children.
- Encourage a parent, guardian, school nurse or qualified clinician
  for personal medical concerns.
- For breathing difficulty, unconsciousness, severe bleeding,
  seizures or severe allergic reactions, tell the user to get
  immediate adult help and contact emergency services.
- For emergencies in India, 112 is the emergency number.
- Never request names, addresses, passwords or private medical records.
- Explain that your answers are educational, not a replacement for
  professional medical advice.
`;

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";

    // Set ALLOWED_ORIGIN to your exact GitHub Pages origin.
    // Example: https://yourusername.github.io
    if (!allowedOrigin || origin !== allowedOrigin) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Vary": "Origin",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Use POST to send a chat message." }, 405, allowedOrigin);
    }

    if (!env.GROQ_API_KEY) {
      return json({ error: "GROQ_API_KEY secret is missing." }, 500, allowedOrigin);
    }

    try {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 20000) {
        return json({ error: "Request is too large." }, 413, allowedOrigin);
      }

      const body = await request.json();

      if (!Array.isArray(body.messages) ||
          body.messages.length < 1 ||
          body.messages.length > 12) {
        return json({ error: "Invalid conversation history." }, 400, allowedOrigin);
      }

      const valid = body.messages.every(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.length <= 2000
      );

      if (!valid ||
          body.messages[body.messages.length - 1].role !== "user") {
        return json({ error: "Invalid chat message." }, 400, allowedOrigin);
      }

      // Keep only recent conversation turns and cap the total prompt size.
      const messages = body.messages.slice(-10);
      const totalChars = messages.reduce(
        (sum, message) => sum + message.content.length, 0
      );

      if (totalChars > 10000) {
        return json({ error: "Conversation is too long. Start a new chat." }, 400, allowedOrigin);
      }

      const upstream = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...messages
            ],
            temperature: 0.3,
            max_tokens: 700
          })
        }
      );

      if (!upstream.ok) {
        console.error("Groq request failed with status:", upstream.status);
        return json({
          error: upstream.status === 429
            ? "AI usage limit reached. Please try again later."
            : "AI provider request failed. Check your Groq model, API key and Worker logs."
        }, 502, allowedOrigin);
      }

      const result = await upstream.json();
      const reply = result.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        return json({ error: "No AI response was returned." }, 502, allowedOrigin);
      }

      return json({ reply }, 200, allowedOrigin);

    } catch (error) {
      console.error("Worker error:", error);
      return json({ error: "Invalid request or server error." }, 500, allowedOrigin);
    }
  }
};
