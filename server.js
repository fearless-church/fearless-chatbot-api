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

WEEKEND SERVICES (LA CAMPUS):
Fearless gathers every Sunday at 11am in Los Angeles. Each week's location is released on fearless.church and Instagram (@fearlessla). For the current address, always direct visitors to fearless.church/locations or Instagram.
Online Campus: 11am PST, streaming live at youtube.com/@fearlessla/streams. More info at fearless.church/online.

CRITICAL: Never reference San Diego, SD service times, SD addresses, or SD ministries. If asked, respond: "Our San Diego campus is no longer active. We'd love to have you join us for our 11am Sunday service in LA. Check fearless.church for this week's location."

NEXT (SERVE AT FEARLESS):
A course designed to help you discover your gifts and join a serving team at Fearless.
Every 3rd Monday of the month at 7pm.
Sign up and learn more: fearless.church/next

X18 (SMALL GROUPS & DISCIPLESHIP):
X18 is currently on pause. We will be relaunching soon. Direct visitors to fearless.church/x18 for updates, or suggest they connect with us at info@fearless.church to be notified when X18 returns.

FIRST TIME VISITORS vs NEWLY SAVED:
These are two different paths.
First Time Visitor: Someone new to Fearless who wants to connect. Direct them to: fearlessla.churchcenter.com/people/forms/37474
Newly Saved / New Believer: Someone who just gave their life to Christ. Celebrate their decision! Direct them to: fearless.church/salvation for next steps, and to the New Believers Class (Mondays at 7pm in LA).
New Believers Class sign up: fearlessla.churchcenter.com/people/forms/37474

WEEKLY SCHEDULE:
Monday: Run Club 7:20am (LA), New Believers Class 7pm, Next (every 3rd Monday) 7pm
Wednesday: Outreach at Casa LA Futebol 12pm to 3pm (2800 E 12th St, LA), The Bible Study w/ Pastor Jeremy 12pm PST (YouTube: youtube.com/@jeremyjohnson_la)
Sunday: LA Campus Service at 11am (location on fearless.church and Instagram), Online Campus at 11am (youtube.com/@fearlessla/streams)

HARVEST HANDS (BUILDING CAMPAIGN):
Fearless Church is believing God for $3,000,000 to secure and prepare a permanent home for the harvest in Hollywood at 6230 W Sunset Blvd.
Phase One ($1.5M): April 26 through Pentecost Sunday, May 24. Five Sundays of giving.
Phase Two ($1.5M): Building out the sanctuary, kids spaces, and gathering place.
Two ways to give: a one-time gift or a 12-month faith commitment (monthly giving).
All gifts are tax deductible (501c3). 100% of Harvest Hands gifts go directly to the building campaign.
Give online: donate.overflow.co/fearless/cash?config=harvest-hands
Creative giving (stock, IRA, real estate): donate.overflow.co/fearless/stock/select-flow
Mail checks to: Fearless Church, 22922 Los Alisos Blvd., Ste K-361, Mission Viejo, CA 92691 (memo: Harvest Hands)
Full vision and details: harvesthands.fearless.church
This is above and beyond regular tithes and offerings. It is a faith commitment, not a contract.

PASTORS:
Jeremy & Christy Johnson are Lead Pastors and founders of Fearless (founded 2012), passionate about revival and creative evangelism. They have three children: Lyric, Brave, and Arrow.
Extended bio: fearless.church/ourpastors
Book our pastors for events: fearlessla.wufoo.com/forms/zaia9q40xsmu9k/
Pastor Jeremy's personal site: jeremyjohnson.la

CORE VALUES:
Jesus Is Our Pursuit, People Are Our Passion, Generosity Is Our Joy, Family Is Our Commitment, Worship Is Our Weapon, Freedom Is Our Sound, Love Is Our Action, Servanthood Is Our Position, Honor Is Our Privilege, Excellence Is Our Spirit, Prayer Is Our Source

WHAT WE BELIEVE:
Fearless is built upon the creed from 1 John 4:18: "There is no fear in love. But perfect love drives out fear."
Full statement of faith: fearless.church/what-we-believe

GIVING:
Online: fearless.church/give
Text GIVE to 213-214-1314

FEARLESS PARTNERS:
A Fearless Partner is anyone who sets up their tithe (10%) as recurring giving. Partners enable the church to keep ministry high and overhead low. Each month, Partners receive a newsletter celebrating wins and gifts to honor their contribution.
Legacy Partners: Recurring giving of $50 or more per month.
Find your tithe: tithes.app
Become a Partner: fearless.church/partners
Give to LA: donate.overflow.co/fearless/cash?config=fearless-la

CONTACT & PRAYER:
General inquiries: info@fearless.church
Prayer requests: fearless.church/prayer

CONNECT WITH A PASTOR:
Link: https://linktr.ee/fearlessconnect

BEYOND SUNDAY:
A resource page featuring sermon recaps, reflection questions, and links to watch the latest messages from our pastors. A great place to go deeper in the Word throughout the week.
Link: fearless.church/beyond
Watch sermons: youtube.com/@fearlessla

EVENTS:
Fearless Conference 2027: February 18 to 20, 2027 in Los Angeles. A three-day gathering designed to empower and equip the Church. Hosted by Jeremy & Christy Johnson. Register: fearless.ticketsauce.com/e/conf27
Man Camp 2026: fearless.ticketsauce.com/e/mancamp2026
She Is Fearless: fearless.ticketsauce.com/e/sif
Love Loud LA: loveloudla.org

MINISTRIES:
Fearless Kidz: For children aged 4 months to 12 years, available during the 11am service. More info: fearless.church/kidz
Fearless Youth: Junior high and high school students. More info: fearless.church/fearless-youth
Brave Gen: fearless.church/brave-gen
Fearless BND (Band/Worship Team): hopp.bio/fearlessbnd
Fearless Worship: fearless.church/worship
Fearless Outreach: Community service including weekly grocery drives. Since Covid, over 5,500,000 pounds of groceries distributed. More info: fearless.church/outreach
Fearless Online: fearless.church/online
Fearless Apparel: fearless-apparel.com
Justice & Mercy: fearless.church/justiceandmercy

OUR STORY:
fearless.church/ourstory

RESPONSE RULES:
- Be link-heavy. Always provide the relevant URL.
- Stay concise, under 60 words per response.
- Avoid assumptions about the visitor.
- Use time-aware phrasing.
- Never ask for personal info beyond name and email.
- Do not reference the SD campus.
- For all service location questions, direct to fearless.church and Instagram.
- Never use dashes (hyphens between words for compound thoughts) or em-dashes in your responses.
- Keep a warm, welcoming energy. You represent Fearless Church.
- When someone says they just got saved, celebrate enthusiastically and direct to fearless.church/salvation.
- When someone asks about the building or permanent location, share the Harvest Hands vision.

ESCALATION PROTOCOL:
When you cannot confidently answer a visitor's question from your knowledge base, do NOT make up an answer. Instead:
1. Let the visitor know you want to make sure they get the best answer from the team.
2. Ask for their name and email so you can connect them with someone who can help.
3. Once they provide their name and email, respond with EXACTLY this format on its own line at the end of your message:
[ESCALATE: name="Their Name" email="their@email.com" question="Their original question summarized"]
The system will automatically send an email to the team and CC the visitor.
Only use this format after you have collected both their name and email. Never include this tag without both pieces of info.`;

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
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    let assistantMessage =
      response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n") || "I'm sorry, I couldn't process that. Please try again.";

    const escalateMatch = assistantMessage.match(
      /\[ESCALATE:\s*name="([^"]+)"\s*email="([^"]+)"\s*question="([^"]+)"\]/
    );

    if (escalateMatch) {
      const visitorName = escalateMatch[1];
      const visitorEmail = escalateMatch[2];
      const visitorQuestion = escalateMatch[3];

      assistantMessage = assistantMessage
        .replace(escalateMatch[0], "")
        .trim();

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || "Fearless Assistant <assistant@fearless.church>",
          to: ["info@fearless.church"],
          cc: [visitorEmail],
          replyTo: visitorEmail,
          subject: `Chat Assistant: Question from ${visitorName}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #0A0A0A; padding: 24px; text-align: center;">
                <h1 style="color: #FFFFFF; font-size: 20px; margin: 0; letter-spacing: 0.04em;">FEARLESS CHURCH</h1>
                <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 4px;">Chat Assistant Escalation</p>
              </div>
              <div style="padding: 32px 24px; background: #FAFAFA;">
                <p style="font-size: 14px; color: #333; line-height: 1.6;">
                  A visitor on <strong>fearless.church</strong> asked a question the assistant could not fully answer.
                </p>
                <div style="background: #FFFFFF; border: 1px solid #E5E5E5; border-radius: 8px; padding: 20px; margin: 20px 0;">
                  <p style="font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Visitor</p>
                  <p style="font-size: 15px; color: #1A1A1A; margin-bottom: 16px;"><strong>${visitorName}</strong> (${visitorEmail})</p>
                  <p style="font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Question</p>
                  <p style="font-size: 15px; color: #1A1A1A;">${visitorQuestion}</p>
                </div>
                <p style="font-size: 13px; color: #666; line-height: 1.5;">
                  Reply to this email to respond directly to <strong>${visitorName}</strong>. They have been CC'd on this message.
                </p>
              </div>
              <div style="padding: 16px 24px; text-align: center; background: #0A0A0A;">
                <p style="font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 0.04em;">FEARLESS CHURCH &bull; fearless.church</p>
              </div>
            </div>
          `,
        });
        console.log(`Escalation email sent for ${visitorName} (${visitorEmail})`);
      } catch (emailError) {
        console.error("Resend email error:", emailError);
      }
    }

    res.json({ message: assistantMessage });
  } catch (error) {
    console.error("Anthropic API error:", error);
    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Fearless Chatbot API running on port ${PORT}`);
});