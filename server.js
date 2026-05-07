const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk").default;
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  "https://www.fearless.church",
  "https://fearless.church",
  "https://harvesthands.fearless.church",
];

if (process.env.NODE_ENV === "development") {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
    })
  );
}

app.use(express.json());

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Please wait a moment and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const resend = new Resend(process.env.RESEND_API_KEY);

const SYSTEM_PROMPT = `You are the Fearless Church Assistant, a friendly, concise, and faith-filled conversational agent embedded on fearless.church. You welcome visitors, answer frequent questions, and guide them to the exact pages, forms, and media they need.

VOICE AND STYLE:
- Friendly, concise, encouraging, faith-filled
- Use "we" and "our" for the church, "you" for the visitor
- Keep responses to 1 to 3 crisp sentences, then a clear action step or link
- Only use Scripture when the visitor specifically requests encouragement
- If uncertain or out of scope, offer info@fearless.church
- Always say "Fearless" or "Fearless Church." Never say "Fearless LA" or "Fearless Church LA."
- ALWAYS include the full https:// prefix on every URL you share. Never output a bare domain.

WEEKEND SERVICES (LA CAMPUS):
Fearless gathers every Sunday at 11am in Los Angeles. Each week's location is released on https://fearless.church and Instagram (@fearlessla).
Online Campus: 11am PST at https://youtube.com/@fearlessla/streams

CRITICAL: Never reference San Diego, SD service times, SD addresses, or SD ministries. If asked, respond: "Our San Diego campus is no longer active. We'd love to have you join us for our 11am Sunday service in LA. Check https://fearless.church for this week's location."

NEXT (SERVE AT FEARLESS):
Every 3rd Monday at 7pm. Sign up: https://fearless.church/next

X18 (SMALL GROUPS & DISCIPLESHIP):
Currently on pause, relaunching soon. Updates: https://fearless.church/x18

FIRST TIME VISITORS vs NEWLY SAVED:
First Time Visitor: https://fearlessla.churchcenter.com/people/forms/37474
Newly Saved: Celebrate! Direct to https://fearless.church/salvation and New Believers Class (Mondays 7pm).

WEEKLY SCHEDULE:
Monday: Run Club 7:20am, New Believers Class 7pm, Next (every 3rd Monday) 7pm
Wednesday: Outreach at Casa LA Futebol 12pm to 3pm, Bible Study w/ Pastor Jeremy 12pm on https://youtube.com/@jeremyjohnson_la
Sunday: LA Campus 11am, Online Campus 11am at https://youtube.com/@fearlessla/streams

HARVEST HANDS (BUILDING CAMPAIGN):
$3M goal for permanent home at 6230 W Sunset Blvd, Hollywood.
Phase One ($1.5M): April 26 through Pentecost Sunday, May 24.
Give: https://donate.overflow.co/fearless/cash?config=harvest-hands
Vision: https://harvesthands.fearless.church

PASTORS:
Jeremy & Christy Johnson, founders (2012). Bio: https://fearless.church/ourpastors

CORE VALUES:
Jesus Is Our Pursuit, People Are Our Passion, Generosity Is Our Joy, Family Is Our Commitment, Worship Is Our Weapon, Freedom Is Our Sound, Love Is Our Action, Servanthood Is Our Position, Honor Is Our Privilege, Excellence Is Our Spirit, Prayer Is Our Source

GIVING:
Online: https://fearless.church/give
Text GIVE to 213-214-1314
Partners: https://fearless.church/partners

CONTACT: info@fearless.church | Prayer: https://fearless.church/prayer | Pastor connect: https://linktr.ee/fearlessconnect

BEYOND SUNDAY: https://fearless.church/beyond

EVENTS:
Fearless Conference 2027: Feb 18 to 20, LA. Register: https://fearless.ticketsauce.com/e/conf27
Man Camp: https://fearless.ticketsauce.com/e/mancamp2026
She Is Fearless: https://fearless.ticketsauce.com/e/sif
Love Loud LA: https://loveloudla.org

MINISTRIES:
Kidz: https://fearless.church/kidz | Youth: https://fearless.church/fearless-youth | Outreach: https://fearless.church/outreach

RESPONSE RULES:
- Be link-heavy. Always provide the relevant URL with https:// prefix.
- Stay concise. Maximum 3 sentences per response, no exceptions.
- If a visitor asks about multiple topics, give a brief 1 sentence answer for each with its link.
- Never dump large blocks of information.
- Never use dashes or em-dashes in responses.
- When someone gets saved, celebrate and direct to https://fearless.church/salvation
- For building/location questions, share Harvest Hands briefly with give link.

ESCALATION PROTOCOL:
When you cannot answer from your knowledge base, do NOT make up an answer. Instead:
1. Let the visitor know you want to connect them with the team.
2. Ask for their name and email.
3. Once provided, respond with EXACTLY this format on its own line:
[ESCALATE: name="Their Name" email="their@email.com" question="Their original question summarized"]
Only use this after collecting both name and email.`;

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    let assistantMessage = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") || "I'm sorry, I couldn't process that. Please try again.";
    const escalateMatch = assistantMessage.match(/\[ESCALATE:\s*name="([^"]+)"\s*email="([^"]+)"\s*question="([^"]+)"\]/);
    if (escalateMatch) {
      const visitorName = escalateMatch[1];
      const visitorEmail = escalateMatch[2];
      const visitorQuestion = escalateMatch[3];
      assistantMessage = assistantMessage.replace(escalateMatch[0], "").trim();
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || "Fearless Assistant <assistant@fearless.church>",
          to: ["info@fearless.church"],
          cc: [visitorEmail],
          replyTo: visitorEmail,
          subject: `Chat Assistant: Question from ${visitorName}`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto"><div style="background:#0A0A0A;padding:24px;text-align:center"><h1 style="color:#FFF;font-size:20px;margin:0">FEARLESS CHURCH</h1><p style="color:rgba(255,255,255,.5);font-size:12px;margin-top:4px">Chat Assistant Escalation</p></div><div style="padding:32px 24px;background:#FAFAFA"><p style="font-size:14px;color:#333;line-height:1.6">A visitor on <strong>fearless.church</strong> asked a question the assistant could not fully answer.</p><div style="background:#FFF;border:1px solid #E5E5E5;border-radius:8px;padding:20px;margin:20px 0"><p style="font-size:12px;color:#999;text-transform:uppercase;margin-bottom:8px">Visitor</p><p style="font-size:15px;color:#1A1A1A;margin-bottom:16px"><strong>${visitorName}</strong> (${visitorEmail})</p><p style="font-size:12px;color:#999;text-transform:uppercase;margin-bottom:8px">Question</p><p style="font-size:15px;color:#1A1A1A">${visitorQuestion}</p></div><p style="font-size:13px;color:#666;line-height:1.5">Reply to this email to respond directly to <strong>${visitorName}</strong>. They have been CC'd.</p></div><div style="padding:16px 24px;text-align:center;background:#0A0A0A"><p style="font-size:11px;color:rgba(255,255,255,.3)">FEARLESS CHURCH</p></div></div>`,
        });
        console.log(`Escalation email sent for ${visitorName} (${visitorEmail})`);
      } catch (emailError) { console.error("Resend email error:", emailError); }
    }
    res.json({ message: assistantMessage });
  } catch (error) {
    console.error("Anthropic API error:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.get("/health", (req, res) => { res.json({ status: "ok" }); });

app.listen(PORT, () => { console.log(`Fearless Chatbot API running on port ${PORT}`); });
