from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from groq import Groq
from tavily import TavilyClient
import os, re, io, json, time, asyncio
from typing import Optional, List
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, HRFlowable
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
import google.generativeai as genai

# ── Init ──────────────────────────────────────────────────────────────────────
app = FastAPI()

GROQ_KEY   = os.getenv("GROQ_API_KEY")
TAVILY_KEY = os.getenv("TAVILY_API_KEY")

# Three Gemini keys — round-robin rotation, triples Flash capacity to 1500 RPD
GEMINI_KEYS = [k for k in [
    os.getenv("GEMINI_API_KEY"),
    os.getenv("GEMINI_API_KEY_2"),
    os.getenv("GEMINI_API_KEY_3"),
] if k]
GEMINI_KEY = GEMINI_KEYS[0] if GEMINI_KEYS else None
_gemini_key_index = 0

def get_gemini_key():
    global _gemini_key_index
    if not GEMINI_KEYS:
        return None
    key = GEMINI_KEYS[_gemini_key_index % len(GEMINI_KEYS)]
    _gemini_key_index += 1
    return key

groq_client   = Groq(api_key=GROQ_KEY or "dummy")
tavily_client = TavilyClient(api_key=TAVILY_KEY or "dummy")

if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)

# ── Model routing ──────────────────────────────────────────────────────────────
# Groq 8b  — extraction, classification, routing (fast, structured, deterministic)
# Groq 70b — reasoning, narrative, brief assembly (deep reasoning tasks)
# Gemini 2.5 Flash — cover letter generation, bullets, cold email (best prose quality)
# Gemini 2.5 Pro   — adversarial judge (cross-model critique, independent evaluation)
MODEL_FAST         = "llama-3.1-8b-instant"       # extraction, classification
MODEL_REASON       = "llama-3.3-70b-versatile"    # reasoning, narrative, brief
MODEL_GEMINI_FLASH = "gemini-2.5-flash-preview-04-17"   # generation
MODEL_GEMINI_PRO   = "gemini-2.5-pro-preview-03-25"     # adversarial judge

# ── Level 1 Canonical — embedded in every prompt ──────────────────────────────
# This tells every model its role in the system, its operating standard,
# and why honesty matters more than impressiveness.
LEVEL_1 = """
SYSTEM ROLE:
You are one component in a multi-stage pipeline built to produce
job application assets — cover letter, resume bullets, interview
preparation, cold outreach email — for a specific candidate
applying to a specific role.

Other components in this pipeline have already parsed the candidate's
CV in full, researched the company across four dimensions, extracted
the candidate's own words about their motivations and proudest moments,
and identified the two core challenges this hire exists to solve.

The pipeline has also derived a narrative thread — the single argument
this application makes. Every asset you produce must serve that
argument. Not repeat it. Serve it — from the angle this specific
asset can reach that no other asset can.

You receive outputs from those components as your inputs.
Your task is clearly defined below.

OPERATING STANDARD:
Precision over completeness. Specific over general. True over impressive.

If the evidence supports a specific claim — make it specific.
If it does not — do not invent specificity.
The candidate will be asked about everything this system produces
in a real interview. It must hold up.

Do not restate inputs. Do not summarise what you were given.
Produce only what your task requires.
"""

# ── Voice and register — embedded in every generation prompt ──────────────────
# Derived from 14 recruiter and hiring manager insights on what makes
# cover letters get read vs deleted. Applied to all five assets.
VOICE_REGISTER = """
VOICE AND REGISTER:
This is written by a human professional who thinks clearly
and has nothing to prove. That is the only register that works.

RHYTHM:
Sentences breathe. Some are short — a result, a fact, a decision.
Some are longer when the idea has weight and needs room to land.
Never three sentences of the same length in a row.
The reader should feel a mind at work, not a template being filled.

SPECIFICITY:
Every claim earns its place with evidence.
Not "strong analytical skills" — the specific analysis and what it changed.
Not "led a team" — how many people, toward what, and what happened.
Vague language is not modest. It is invisible.

PARAGRAPH OPENINGS:
Every paragraph opens with a situation, event, finding, or result.
Never with "I". Never with the candidate's name, title, or feelings.
The first word of every paragraph is the most specific word in it.

BANNED ENTIRELY:
leverage · synergy · passionate about · excited to · results-driven
team player · dynamic · innovative · strategic thinker · hard worker
detail-oriented · proven track record · seeking to · looking to
I believe · I feel · I think · as mentioned · it is worth noting
furthermore · in addition · to that end · I would welcome the opportunity
I look forward to hearing from you · I am writing to apply
pleased to · thrilled to · honoured to · eager to

These phrases exist in every application. They exist in none of the
memorable ones. They are invisible before the recruiter processes them.

TRANSITIONS:
Invisible. The logic of the argument creates movement — not signposting.
The reader should move from one idea to the next without noticing the seam.

SENTENCE CONSTRUCTION:
Active voice. The candidate did things.
No sentence longer than 25 words.
If an idea needs more than 25 words, it needs to be two ideas.

AI PROSE — what to avoid:
Grammatically perfect but rhythmically dead. Every sentence the same weight.
Abstract nouns doing the work that specific evidence should do.
A polish that signals no one wrote this — it was generated.
The hiring manager cannot always name it, but they feel it immediately.

Before writing any sentence, ask: would this sentence exist if the
candidate were different, the role were different, or the company
were different? If it would exist anyway — it does not belong here.

The test is not "is this well-written?" The test is "is this
irreplaceable?" A sentence that passes is one only this candidate
could have written, about their actual work, for this specific role,
at this specific company, today.

WRITING SAMPLE — IF PROVIDED:
The candidate's natural register overrides everything above.
Their sentence length, formality, directness, relationship with punctuation —
these are fingerprints. Sound like them, sharper.
Take their voice and remove whatever makes it casual.
Keep everything that makes it theirs.

IF NO WRITING SAMPLE:
The default is the prose a good long-form journalist writes when explaining
something difficult to someone intelligent.
No filler. No performance. No throat-clearing.
The first sentence earns the second. The second earns the third.
Nothing is there because it is supposed to be.
"""

# ── Few-shot examples — principle-based, derived from real high-performing letters
# These demonstrate one standard, not one structure.
# Each example teaches one principle. Departure is expected when this candidate's
# situation calls for something different.
FEW_SHOT_EXAMPLES = """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FEW-SHOT EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These examples demonstrate moves, not templates.

Before using any example: identify the move it makes — what it does
to the recruiter's attention, and why. Then make the equivalent move
using this candidate's specific evidence.

Do not reproduce the structure. Reproduce the quality of thinking.

The test: would a recruiter who has read 500 letters this month feel
that this argument was worth their time? Not "is it good?" — "is it
worth their time?" Good can be generic. Worth their time cannot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 1 — P1: The observation before the result

THE MOVE: Lead with what you noticed, not what you achieved. The result
proves the observation was right. The recruiter's question after reading
this must not be "impressive" — it must be "how did they see that?"
Impressive closes the reader's attention. Curious opens it.

The onboarding flow had a 23% drop-off that every post-mortem blamed
on the payment gateway. I watched the session recordings instead.

Nobody was reaching the gateway. They were abandoning on the card entry
field — on mobile — because the keyboard was covering the CVV input.
Four hours of front-end work. Drop-off fell to 6% in two weeks.
The gateway was fine. It had always been fine.

That instinct — reading what is actually happening before accepting
the obvious explanation — is what I want to bring to the checkout
work at Razorpay.

WHY THIS WORKS: The first sentence names a real problem and a wrong
consensus. The second sentence reveals that the candidate went and
looked themselves. The result (6%) is almost incidental — it is proof
that the noticing was right. "The gateway was fine. It had always been
fine." — two short declarative sentences showing the candidate is slightly
amused by how obvious it turned out to be. That is voice. The role appears
at the end, once the reader knows what kind of thinker this is.

WHAT TO AVOID: Do not lead with the result and then explain how you
achieved it. That is impressive, not curious. The noticing must come
first. The result follows from what was noticed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 2 — P2: The moment that deepens the argument

THE MOVE: P2 is not a second achievement. It is the proof that P1
was not a one-time observation. It picks up the same instinct and
applies it to a different, harder problem. The recruiter should feel:
this is a pattern of thinking, not a lucky outcome.

The same thing happened with the pricing model six months later.

Enterprise deals were falling apart in final stages. The team assumed
it was the contract terms. I looked at the deal histories instead —
it was not the terms. We were sending the pricing deck before the
customer had articulated their problem clearly enough to understand
why our price made sense. They were in comparison mode. We were in
solution mode. We were out of sync. We changed when we sent the deck.
Win rate in enterprise moved from 31% to 58% over the next quarter.

WHY THIS WORKS: P2 echoes P1's diagnostic move — "I looked at the
deal histories instead" mirrors "I watched the session recordings
instead." The recruiter feels the pattern before they consciously
register it. "They were in comparison mode. We were in solution mode."
— this is the candidate's language for something they have thought
about deeply. You cannot borrow that phrase. It belongs to someone who
lived with that problem long enough to name it. That is what makes P2
believable rather than assembled.

WHAT TO AVOID: Do not list a second achievement. Do not introduce
a new topic. P2 must make P1 feel inevitable in retrospect — like
P1 was the first sentence of an argument that P2 just completed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 3 — P3: Not about the company — about where you are going

THE MOVE: P3 opens with why the candidate cares about this specific
type of work — not the company, not the mission, the actual texture
of the problem. By the time the company is named, the reader already
understands why this particular company makes sense. The connection
is earned, not claimed.

The reason I want to work on checkout infrastructure specifically —
not payments generally — is that the failure modes are visible in a
way they are not upstream. You see exactly where people stop trusting
a transaction. That is rare signal. I want to build where the evidence
is clearest.

Razorpay's expansion into embedded finance for SMEs is where that
signal will be most interesting for the next five years. The gap
between what small businesses need from financial infrastructure and
what they can actually navigate — that is the gap I have been
thinking about.

WHY THIS WORKS: P3 opens with a professional preference, not a company
compliment. "I want to build where the evidence is clearest" is a
statement of what this person values, not what they admire about
Razorpay. By the time Razorpay is named, the reader understands why
specifically Razorpay. Test: could this P3 exist without the candidate
having done the work described in P1 and P2? If yes — it is not
grounded. If no — it is.

WHAT TO AVOID: "I am excited about your innovative approach." "I have
long admired your mission." These are compliments, not connections.
The recruiter knows their company. They are reading to find out what
this candidate sees in it from inside their own professional life.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 4 — Gap or transition: name it, turn it, move

THE MOVE: The gap gets one clause. The reframe gets one sentence.
The letter moves. The confidence with which the transition is handled
is itself evidence — it tells the recruiter this candidate has already
made peace with their path and is not seeking validation for it.

My background is in freight logistics — not payments, not fintech.

But what I have been doing for six years is watching why transactions
stall at the last moment: the shipper who will not commit until the
final rate is confirmed, the carrier who drops off when trust breaks.
The mechanics are different. The psychology of a stalled transaction
is not.

For a career break:
I took fourteen months away. The work I want to do next is clearer
for it — not despite it.

WHY THIS WORKS: The gap is in the subordinate clause, not the dominant
one. The capability is in the dominant clause. "The psychology of a
stalled transaction is not" — five words that do the entire bridging
work. The career break version names the absence in one clause and
pivots immediately to what it produced. No apology. No over-explanation.

WHAT TO AVOID: Any sentence beginning with "Although", "While", or
"Despite." These put the gap in the dominant position and the capability
in the subordinate. That is exactly backwards.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 5 — The close: confidence and humility together, then stop

THE MOVE: The close assumes the conversation is worth having without
claiming more than the letter has earned. It offers a window, makes
one small accommodation for the reader, and stops. Confidence in the
value of the conversation. Respect for the reader's time. Both in the
same breath, without strain.

This week works well for a call — or whenever suits you better.

When the role or relationship warrants slightly more warmth:
Happy to make time whenever works. No rush on your end.

WHY THIS WORKS: "This week works well" assumes the call is happening.
"Or whenever suits you better" — one small accommodation, stated
without performance. It is the close of someone who believes the
conversation is worth having, and who also understands that the person
they are writing to is busy and important. Confidence alone reads as
presumption. Humility alone reads as deference. Both together, in one
sentence, is the register.

WHAT TO AVOID: "I look forward to hearing from you." "I hope to have
the opportunity to discuss my qualifications." "Thank you for your
time and consideration." Each of these gives power to the recruiter
and takes it from the candidate. A close should make the next step
feel obvious — not request that it might happen.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANTI-EXAMPLES — what the recruiter has already seen today

ANTI-EXAMPLE 1 — The AI rhythm tell:
"I am excited to apply for the Senior Product Manager position at
Razorpay. With my extensive background in product management and
my proven track record of driving results, I am confident that I
would be an excellent addition to your innovative team."
FAILS: Every sentence the same length and weight. Abstract nouns doing
the work specific evidence should do. The recruiter identifies this
as generated before they have processed a single claim it makes.

ANTI-EXAMPLE 2 — Context before evidence:
"Having spent five years in B2B SaaS across growth and retention,
I have developed a deep understanding of the challenges facing
product teams in fintech."
FAILS: Where the candidate has been, before what they have done.
"Deep understanding" contains no information. Start with what happened.
Context emerges from evidence — it does not precede it.

ANTI-EXAMPLE 3 — Briefing the company on their own business:
"Razorpay has established itself as India's leading payment
infrastructure company, serving over 8 million businesses."
FAILS: The recruiter knows their company. They are reading to find
out about the candidate. The single most recognisable pattern in
AI-generated letters — and the most reliable signal to skip ahead.

ANTI-EXAMPLE 4 — The assembled letter:
"My five years in product management, combined with my experience
in data analytics and cross-functional leadership, make me a strong
candidate for this role. I have driven revenue growth, improved
retention metrics, and led teams through complex product cycles."
FAILS: Every sentence true. None of them connect. The reader learns
what the candidate has done but not what they see, how they think,
or why any of it matters to this specific role. Individual ingredients.
No argument. This is the concoction — and it is the most common failure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW THESE MOVES CONNECT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

P1 raises a question by showing what the candidate noticed.
P2 answers that question by proving the noticing is a pattern.
P3 earns the company connection because P2 revealed the candidate's
thinking — and the company is where that thinking is most needed.
P4 is the only logical next step because the first three paragraphs
already made the case.

The four paragraphs are not four demonstrations. They are one argument
told in four movements. Each movement makes the next one possible.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPARTURE INSTRUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These examples demonstrate moves, not templates.

The move is what each example does to the reader's attention.
The template is the surface structure that carries the move.
One is worth learning. The other is worth departing from.

Before writing a single sentence: identify what move this candidate's
evidence can make. What can they show that would make the recruiter
lean forward rather than continue skimming? Write from that.

If the candidate's evidence is thinner than these examples,
do not reach for the examples' vividness. Find the most honest
specific thing available and build from that. A modest letter
with one real observation is better than a vivid letter with
borrowed confidence.

The standard is not "does this letter follow the structure of the
examples?" The standard is: would a recruiter who has read 500 letters
this month feel that this argument was worth their time?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

# ── Request models ─────────────────────────────────────────────────────────────
class ResearchRequest(BaseModel):
    cv_text: str
    jd_text: str
    manual_company: Optional[str] = ""

class BriefRequest(BaseModel):
    brief: dict
    answers: dict  # now contains: bullet_qa, anything_missed, open_field

class RoutingRequest(BaseModel):
    brief: dict

class GenerateRequest(BaseModel):
    brief: dict
    selected_assets: List[str]
    tones: List[str] = []
    writing_sample: Optional[str] = ""
    application_context: Optional[dict] = {}
    routing_choices: Optional[dict] = {}

class RefineRequest(BaseModel):
    current_text: str
    feedback: str
    output_type: str
    brief: dict
    tones: List[str] = []
    writing_sample: Optional[str] = ""
    letter_brief: Optional[dict] = {}
    paragraph_focus: Optional[str] = ""

class RethinkOpeningRequest(BaseModel):
    current_letter: str
    new_opening_approach: str
    brief: dict
    tones: List[str] = []
    writing_sample: Optional[str] = ""

class BulletsRequest(BaseModel):
    brief: dict
    bullet_context: Optional[str] = ""

class DownloadRequest(BaseModel):
    text: str
    candidate_name: Optional[str] = ""
    company: Optional[str] = ""
    asset_type: Optional[str] = "cover_letter"

class ExtractTextRequest(BaseModel):
    filename: str
    content_b64: str

class ExtractImageRequest(BaseModel):
    """For extracting JD text from image or PDF via Gemini Flash multimodal."""
    content_b64: str
    media_type: str  # image/jpeg, image/png, application/pdf

class FormAnswerRequest(BaseModel):
    """For answering job application form questions from brief."""
    brief: dict
    form_content_b64: Optional[str] = ""   # base64 image of form
    form_media_type: Optional[str] = ""    # image/jpeg or image/png
    form_text: Optional[str] = ""          # pasted form questions (alternative to image)
    writing_sample: Optional[str] = ""

# ── Core LLM — model routing by task type ─────────────────────────────────────
def llm(prompt, max_tokens=800, quality="fast", temperature=None, retries=3):
    """
    quality="fast"   → Groq 8b  — extraction, classification, structured output
    quality="high"   → Groq 70b — generation, reasoning, nuanced output
    """
    model = MODEL_REASON if quality == "high" else MODEL_FAST
    if temperature is None:
        temperature = 0.2 if quality == "fast" else 0.5
    for attempt in range(retries):
        try:
            res = groq_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return res.choices[0].message.content.strip()
        except Exception as e:
            err = str(e)
            if '429' in err or 'rate_limit' in err.lower():
                if attempt < retries - 1:
                    wait = 5 * (attempt + 1)
                    try:
                        m = re.search(r'try again in (\d+\.?\d*)s', err)
                        if m:
                            wait = float(m.group(1)) + 1.0
                    except:
                        pass
                    time.sleep(wait)
                    continue
            raise Exception(f"LLM error: {err}")
    raise Exception("LLM error: rate limit — wait a moment and try again")

# ── Gemini LLM — generation and adversarial judging ───────────────────────────
def llm_gemini(prompt, max_tokens=1200, model=None, temperature=0.7):
    """
    model=MODEL_GEMINI_FLASH → cover letter generation, bullets, cold email
    model=MODEL_GEMINI_PRO   → adversarial judge (cross-model critique)

    Rotates across up to 3 Gemini keys on 429 — triples Flash capacity.
    Falls back to Groq 70b if all keys exhausted or Gemini not configured.
    """
    if not GEMINI_KEYS:
        return llm(prompt, max_tokens=max_tokens, quality="high", temperature=temperature)

    target_model = model or MODEL_GEMINI_FLASH
    keys_to_try = list(GEMINI_KEYS)  # try all available keys

    for key in keys_to_try:
        try:
            genai.configure(api_key=key)
            gemini_model = genai.GenerativeModel(
                model_name=target_model,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=max_tokens,
                    temperature=temperature,
                )
            )
            response = gemini_model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            err = str(e)
            if '429' in err or 'quota' in err.lower() or 'rate' in err.lower():
                # Rate limited on this key — try next key immediately
                continue
            # Non-rate-limit error — fall back to Groq immediately
            try:
                return llm(prompt, max_tokens=max_tokens, quality="high", temperature=temperature)
            except Exception:
                raise Exception(f"Gemini error (fallback also failed): {err}")

    # All keys exhausted — fall back to Groq
    try:
        return llm(prompt, max_tokens=max_tokens, quality="high", temperature=temperature)
    except Exception as e:
        raise Exception(f"Gemini error: all keys rate limited, Groq fallback also failed: {str(e)}")

# ── Parsing helpers ────────────────────────────────────────────────────────────
def parse_field(text, field_name):
    pattern = rf'{re.escape(field_name)}:\s*(.+?)(?=\n[A-Z_]{{3,}}:|$)'
    match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else ''

# ── CV parsing — one-time structured extraction, foundation of everything ──────
# Groq 8b — structured extraction task, deterministic output needed
def parse_cv(cv_text):
    """
    Extracts structured CV data on Step 1 Continue click.
    This is the foundation — every downstream prompt references this
    rather than truncated raw text.
    Returns a structured dict, not a blob.
    """
    if not cv_text or len(cv_text.strip()) < 50:
        return {}
    try:
        result = llm(
            f"""{LEVEL_1}

YOUR TASK:
Parse this CV into a structured brief. This is the foundation
of the entire application pipeline. Everything built afterward
references this parsing — not the raw CV text.

Extract with precision. Do not inflate. Do not infer beyond
what the text supports. If a field has no evidence, output NONE.

CV TEXT:
{cv_text[:4000]}

Output EXACTLY these fields, no markdown, no preamble:
CANDIDATE_NAME: [full name from top of CV]
CURRENT_ROLE: [most recent job title + company + approximate tenure]
PREVIOUS_ROLES: [prior 2-3 roles, one line each, format: Title at Company (Year-Year)]
CAREER_ARC: [one sentence describing the trajectory — growing specialist, generalist pivot, etc.]
TOP_ACHIEVEMENT_1: [strongest measurable achievement — specific metric + mechanism + context]
TOP_ACHIEVEMENT_2: [second strongest — same standard]
TOP_ACHIEVEMENT_3: [third strongest — same standard]
ALL_METRICS: [every number that appears in the CV — percentages, revenue, team sizes, timelines]
STRONGEST_SKILL: [the one capability most consistently demonstrated across roles]
UNDERSOLD_SIGNALS: [achievements described without metrics or vaguely — targets for Step 3.5 questions]
SKILLS_AND_TOOLS: [explicit list of technologies, methodologies, domain knowledge]
EDUCATION: [degree, institution, year — one line]
GAPS_IN_TIMELINE: [any gaps between roles, or NONE]
CAREER_TRANSITIONS: [any industry or function changes, or NONE]""",
            max_tokens=800, quality="fast"
        )
        parsed = {}
        for field in ['CANDIDATE_NAME','CURRENT_ROLE','PREVIOUS_ROLES','CAREER_ARC',
                      'TOP_ACHIEVEMENT_1','TOP_ACHIEVEMENT_2','TOP_ACHIEVEMENT_3',
                      'ALL_METRICS','STRONGEST_SKILL','UNDERSOLD_SIGNALS',
                      'SKILLS_AND_TOOLS','EDUCATION','GAPS_IN_TIMELINE','CAREER_TRANSITIONS']:
            parsed[field.lower()] = parse_field(result, field)
        return parsed
    except Exception as e:
        return {'parse_error': str(e)}

# ── Company name and job title extraction — Groq 8b ───────────────────────────
def extract_company_name(jd_text):
    try:
        result = llm(
            f"Extract the hiring company name from this job description.\n"
            f"If a recruiting agency posted on behalf of a client, extract the CLIENT company.\n"
            f"Output ONLY the company name or UNKNOWN.\n\nJD:\n{jd_text[:2000]}\n\nOutput:",
            max_tokens=30, quality="fast", temperature=0.1
        )
        return "" if result.strip().upper() == "UNKNOWN" else result.strip()
    except:
        return ""

def extract_job_title(jd_text):
    try:
        return llm(
            f"Extract the job title from this job description.\n"
            f"Output ONLY the job title. If unclear output: Role\n\nJD:\n{jd_text[:500]}\n\nJob title:",
            max_tokens=20, quality="fast", temperature=0.1
        ).strip() or "Role"
    except:
        return "Role"

def check_jd_thinness(jd_text):
    words = re.findall(r'\b\w+\b', jd_text)
    skill_patterns = [
        r'\b(experience|skills?|knowledge|ability|proficiency)\b',
        r'\b(manage|lead|develop|build|design|analys|coordinate)\b',
        r'\b(required|preferred|must have|qualification)\b',
        r'\b(\d+\+?\s*years?|degree|bachelor|master)\b'
    ]
    signal_count = sum(len(re.findall(p, jd_text.lower())) for p in skill_patterns)
    return len(words) < 80 and signal_count < 3

# ── Style fingerprint — Groq 8b ────────────────────────────────────────────────
def extract_style_fingerprint(sample_text):
    if not sample_text or len(sample_text.strip()) < 30:
        return ""
    try:
        return llm(
            f"Writing style analyst. Extract pure stylistic signals from this sample.\n"
            f"Ignore content entirely — analyse HOW this person writes.\n\n"
            f"Sample:\n{sample_text[:1500]}\n\n"
            f"Output 6 numbered writing instructions based strictly on evidence in the sample:\n"
            f"1. SENTENCE LENGTH AND RHYTHM — short/long/mixed, what pattern\n"
            f"2. FORMALITY LEVEL — how formal, what signals\n"
            f"3. FIRST PERSON USAGE — frequency and context\n"
            f"4. HOW THEY USE NUMBERS — present or absent, how deployed\n"
            f"5. VOCABULARY REGISTER — simple/complex, specific words that characterise\n"
            f"6. EMOTIONAL REGISTER — warm/cool/direct/measured\n\n"
            f"One line each. Based only on what is in the sample.",
            max_tokens=300, quality="fast"
        )
    except:
        return ""

def build_voice_instruction(writing_sample=""):
    fingerprint = extract_style_fingerprint(writing_sample) if writing_sample else ""
    if fingerprint:
        return f"CANDIDATE VOICE — from their writing sample (overrides all defaults):\n{fingerprint}\n\nMatch this register precisely. Sharper, not different."
    return "CANDIDATE VOICE — no writing sample provided. Apply default human register as specified in VOICE AND REGISTER above."

# ── Four-search Tavily — deep company research ─────────────────────────────────
def run_company_research(company, job_title, jd_text):
    """
    Four targeted searches — run in parallel via threads, then LLM-processed.
    Drops research time from 30-40s to 10-15s.
    """
    results = {
        'strategic': '',
        'culture': '',
        'role': '',
        'industry': '',
        'company_hook': '',
        'interview_process': '',
    }

    def safe_search(query, depth="basic", max_r=3, days=None):
        try:
            params = {"query": query, "search_depth": depth, "max_results": max_r}
            if days:
                params["days"] = days
            r = tavily_client.search(**params)
            return "\n".join([x["content"][:500] for x in r.get("results", [])])
        except:
            return ""

    # Run all four searches in parallel using threads
    from concurrent.futures import ThreadPoolExecutor, as_completed
    search_tasks = {
        's1':  (f"{company} strategy product direction 2025 news funding expansion", "advanced", 4, 180),
        's2a': (f"{company} culture employees work experience review 2024 2025", "advanced", 3, 365),
        's2b': (f"{company} {job_title} interview process questions experience glassdoor", "advanced", 3, 365),
        's3':  (f"{company} {job_title} responsibilities day to day what does job involve", "advanced", 3, 365),
        's4':  (f"{company} competitors market challenges 2025", "basic", 3, 180),
    }
    search_results = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(safe_search, *args): key for key, args in search_tasks.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                search_results[key] = future.result()
            except:
                search_results[key] = ""

    s1  = search_results.get('s1', '')
    s2a = search_results.get('s2a', '')
    s2b = search_results.get('s2b', '')
    s3  = search_results.get('s3', '')
    s4  = search_results.get('s4', '')

    # Process Search 1 — Strategic context
    if s1:
        try:
            results['strategic'] = llm(
                f"""{LEVEL_1}

YOUR TASK:
Extract what is strategically relevant to someone applying for
{job_title} at {company} right now.

PRIMARY INPUT — weight this most heavily:
Recent news and announcements about {company}.

Focus only on:
- What has changed in the last 12 months that makes this hire urgent
- Direction the company is moving — new markets, products, priorities
- Any pressure or challenge the company is publicly navigating
- What stage the company is at and what problems come with that stage

Do not summarise generally. Extract only what is relevant to this
specific moment in the company's life and this specific hire.
3-4 sentences. Factual. If results contain nothing relevant, say so.

SEARCH RESULTS:
{s1[:2000]}

[If empty: output NONE_FOUND]""",
                max_tokens=200, quality="fast"
            )
        except:
            pass

    # Process Search 2 — Culture and interview process
    if s2a or s2b:
        try:
            results['culture'] = llm(
                f"""{LEVEL_1}

YOUR TASK:
Extract what is genuinely useful for a candidate to know about
working at {company} and their interview process for {job_title}.

This is not about selling the company — it is about giving the
candidate an honest, specific picture.

PRIMARY INPUT — weight culture reality most heavily:
What employees actually say, not what the careers page says.

Extract:
- What the company actually values in practice
- What successful people at this company tend to have in common
- Any cultural realities worth knowing — pace, expectations, what gets rewarded
- Interview process specifics for this role type if found
- Any consistent interview questions that appear across multiple accounts

4-5 sentences. Honest. If reviews are thin, note the limitation.
Cite source type where possible (Glassdoor, Reddit, etc.)

CULTURE RESULTS:
{s2a[:1500]}

INTERVIEW PROCESS RESULTS:
{s2b[:1500]}

[If empty: output NONE_FOUND]""",
                max_tokens=250, quality="fast"
            )
        except:
            pass

        # Extract interview process specifically for interview prep asset
        if s2b:
            results['interview_process'] = s2b[:1000]

    # Process Search 3 — Role reality
    if s3:
        try:
            results['role'] = llm(
                f"""{LEVEL_1}

YOUR TASK:
Build a picture of what {job_title} at {company} actually involves
day to day — not what the JD says, but what people doing this work
at this company actually spend their time on.

PRIMARY INPUT — weight this most heavily:
LinkedIn profiles of people in similar roles, Glassdoor role descriptions,
company blog posts about the team.

Extract:
- Core outputs of this role week to week
- Technical or functional skills used most in practice
- Who this role works with — cross-functional context where visible
- What makes someone exceptional vs competent in this role here
- Specific projects, products, or initiatives this role likely touches

4-5 sentences. Concrete. If role-specific information is thin,
extract closest available and note the gap.

SEARCH RESULTS:
{s3[:2000]}

[If empty: output NONE_FOUND]""",
                max_tokens=200, quality="fast"
            )
        except:
            pass

    # Process Search 4 — Industry pressure
    if s4:
        try:
            results['industry'] = llm(
                f"""{LEVEL_1}

YOUR TASK:
Extract market and competitive context most relevant to someone
in {job_title} at {company}.

PRIMARY INPUT — industry and competitive landscape.

Extract:
- Biggest pressures or opportunities in this space right now
- Where {company} sits relative to competitors
- Macro forces shaping this industry that {company} cannot ignore
- Any specific competitive dynamics relevant to this hire

3 sentences maximum. Strategic context only.
Skip anything generic about the industry.

SEARCH RESULTS:
{s4[:1500]}

[If empty: output NONE_FOUND]""",
                max_tokens=150, quality="fast"
            )
        except:
            pass

    # Derive company hook — most specific single observation for P3 and cold email
    all_context = f"{results['strategic']} {results['role']}".strip()
    if all_context and 'NONE_FOUND' not in all_context:
        try:
            results['company_hook'] = llm(
                f"From this company research, extract ONE specific, non-obvious observation about "
                f"{company} that a serious candidate would find genuinely interesting — "
                f"not a generic mission statement, a specific product direction, challenge, or decision.\n"
                f"One sentence only. If nothing specific found, output NONE.\n\n"
                f"Research:\n{all_context[:1000]}",
                max_tokens=80, quality="fast"
            )
        except:
            pass

    return results

# ── Research agent — orchestrates Tavily + LLM extraction ─────────────────────
def run_research_agent(cv_text, jd_text, manual_company=""):
    brief = {'cv_text': cv_text, 'jd_text': jd_text}
    thin_warning = "Short JD detected — pain points may be less targeted." if check_jd_thinness(jd_text) else ""

    company = extract_company_name(jd_text)
    if not company and manual_company:
        company = manual_company.strip()
    brief['company']        = company
    brief['job_title']      = extract_job_title(jd_text)
    brief['candidate_name'] = parse_field(cv_text[:200], 'name') or cv_text.split('\n')[0].strip()[:60]

    if not company:
        return {"error": "company_not_found", "thin_warning": thin_warning, "brief": brief}

    try:
        # Run four-search company research
        company_research = run_company_research(company, brief['job_title'], jd_text)
        brief.update({
            'strategic_context':  company_research['strategic'],
            'culture_reality':    company_research['culture'],
            'role_reality':       company_research['role'],
            'industry_pressure':  company_research['industry'],
            'company_hook':       company_research['company_hook'],
            'interview_process':  company_research['interview_process'],
        })

        # Confidence signal — tell user what we found
        found_dims = sum(1 for k in ['strategic','culture','role','industry']
                        if company_research.get(k,'') and 'NONE_FOUND' not in company_research.get(k,''))
        if found_dims >= 3:
            research_confidence = f"Substantial information found about {company} across {found_dims} dimensions."
        elif found_dims >= 1:
            research_confidence = f"Limited information found about {company}. Pain points are based primarily on the JD."
        else:
            research_confidence = f"No public information found about {company}. Pain points derived from JD only."
        brief['research_confidence'] = research_confidence

        time.sleep(1.5)

        # Extract role signals from JD — Groq 8b
        combined = llm(
            f"""{LEVEL_1}

YOUR TASK:
Decode the signals in this job description at {company}.

PRIMARY INPUT — the JD is the primary document:
Read it not as a checklist but as a window into the company's
current state. What problem does the absence of this person create?

JD TEXT (full):
{jd_text[:3000]}

COMPANY CONTEXT:
{company_research['strategic'][:400]}

Output EXACTLY these fields, no preamble, no markdown, no bold:
CORE_PROBLEM: [one sentence — why this role exists now, not what it does]
SENIORITY_SIGNAL: [Senior/Mid/Junior]
OWNERSHIP_LEVEL: [Execute/Contribute/Lead/Define]
INDUSTRY_REGISTER: [5-6 specific terms this company uses — from JD language]
HIRING_MOMENT: [Growth/Replacement/Transformation]
MUST_HAVE_SIGNALS: [top 3 non-negotiable requirements — specific]
SOFT_SIGNALS: [1-2 cultural expectations visible in JD language]""",
            max_tokens=450, quality="fast"
        )

        for field in ['CORE_PROBLEM','SENIORITY_SIGNAL','OWNERSHIP_LEVEL','INDUSTRY_REGISTER',
                      'HIRING_MOMENT','MUST_HAVE_SIGNALS','SOFT_SIGNALS']:
            brief[field.lower()] = parse_field(combined, field)

        # Derive company stage from strategic context — used by cover letter P3 and routing
        hiring_moment = brief.get('hiring_moment', '').lower()
        strategic = company_research.get('strategic', '').lower()
        if any(w in strategic for w in ['series', 'funding', 'seed', 'startup', 'early']):
            brief['derived_company_stage'] = 'early'
        elif any(w in strategic for w in ['ipo', 'public', 'nasdaq', 'nyse', 'enterprise']):
            brief['derived_company_stage'] = 'public'
        elif hiring_moment == 'growth':
            brief['derived_company_stage'] = 'scaling'
        else:
            brief['derived_company_stage'] = 'growing'

        # Derive career situation from parsed CV — used by routing and cover letter
        parsed_cv = brief.get('parsed_cv', {})
        transitions = (parsed_cv.get('career_transitions', '') or '').lower()
        gaps = (parsed_cv.get('gaps_in_timeline', '') or '').lower()
        arc = (parsed_cv.get('career_arc', '') or '').lower()
        if gaps and gaps != 'none':
            brief['derived_career_situation'] = 'gap'
        elif transitions and transitions != 'none':
            brief['derived_career_situation'] = 'pivot'
        elif any(w in arc for w in ['senior', 'lead', 'director', 'head', 'vp']):
            brief['derived_career_situation'] = 'step_up'
        else:
            brief['derived_career_situation'] = 'growing'

        time.sleep(1.5)

        # Pain point generation — Groq 70b
        # Moved away from template entirely — describes situations, not capabilities
        pain_raw = llm(
            f"""{LEVEL_1}

YOUR TASK:
Produce five pain points — the five real situations this specific hire
exists to navigate at this specific company at this specific moment.

WHY THIS MATTERS:
These five pain points are the spine of everything built after this.
The candidate selects two. Those two become the argument the cover letter
makes, the lens through which CV bullets are selected, and the frame
for interview preparation. If these are generic, everything downstream
is generic. If they are specific, everything downstream is differentiated.

WHAT EACH INPUT CONTRIBUTES:

JD TEXT — your primary document:
Read this not as a checklist but as a window into the company's
current state. What does the absence of this person cost them?
What does success in this role make possible that is not possible today?
[Weight this most heavily]

STRATEGIC CONTEXT — why now:
What has changed that makes this hire urgent or necessary?
Use this to make pain points time-specific, not evergreen.
[Use to add urgency and specificity]

CULTURAL REALITY — how the work gets done:
What does this company actually reward? Use this to ensure pain
points reflect the real environment this hire will navigate.
[Use to ground in reality, not aspiration]

ROLE REALITY — what the work actually involves:
Not what the JD says — what people in this role actually do.
Use this to ground pain points in daily work.
[Use to add day-to-day specificity]

INDUSTRY PRESSURE — what the company cannot ignore:
Use sparingly — only when it directly shapes what this hire handles.
[Supporting context only]

CANDIDATE BACKGROUND — the intersection:
Each pain point must connect to something real in this candidate's
background. Not invented alignment. A genuine capability demonstrated.
If no connection exists, do not force one.
[Use to ensure relevance to this specific candidate]

WHAT GOOD LOOKS LIKE:
A pain point that makes the candidate immediately think:
"I have dealt with exactly this." It is specific to this company's
moment. It emerges from reading between the lines of the JD,
not from restating it.

WHAT FAILURE LOOKS LIKE:
"Needs someone who can lead cross-functional teams."
"Requires strong analytical skills."
These are JD requirements dressed as situations. Do not produce them.

JD TEXT:
{jd_text[:3000]}

STRATEGIC CONTEXT:
{company_research['strategic'][:400]}

CULTURAL REALITY:
{company_research['culture'][:400]}

ROLE REALITY:
{company_research['role'][:400]}

INDUSTRY PRESSURE:
{company_research['industry'][:300]}

CANDIDATE BACKGROUND:
{cv_text[:800]}

OUTPUT FORMAT — exactly 5 lines, nothing else, no markdown:
Each pain point is ONE sentence, maximum 20 words. A situation, not a capability.
PAIN_1: [one sentence — specific situation, max 20 words]
PAIN_2: [one sentence — specific situation, max 20 words]
PAIN_3: [one sentence — specific situation, max 20 words]
PAIN_4: [one sentence — specific situation, max 20 words]
PAIN_5: [one sentence — specific situation, max 20 words]""",
            max_tokens=400, quality="high"
        )

        pain_points = []
        for line in pain_raw.split('\n'):
            line = line.strip()
            m = re.match(r'^PAIN_\d:\s*(.+)', line)
            if m:
                text = m.group(1).strip()
                text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
                if len(text) > 15:
                    pain_points.append(text)

        # Fallback
        if len(pain_points) < 2:
            pain_points = [
                l.strip() for l in pain_raw.split('\n')
                if len(l.strip()) > 20 and not l.strip().startswith('PAIN_')
            ][:5]

        # Build company briefing for display
        company_briefing_display = "\n\n".join(filter(None, [
            f"**Strategic context:** {company_research['strategic']}" if company_research['strategic'] and 'NONE_FOUND' not in company_research['strategic'] else "",
            f"**Culture:** {company_research['culture'][:300]}" if company_research['culture'] and 'NONE_FOUND' not in company_research['culture'] else "",
            f"**The role in practice:** {company_research['role'][:300]}" if company_research['role'] and 'NONE_FOUND' not in company_research['role'] else "",
            f"\n*{research_confidence}*",
            f"\n*{thin_warning}*" if thin_warning else "",
        ]))

        return {
            "brief": brief,
            "company_briefing": company_briefing_display,
            "pain_points": pain_points,
            "thin_warning": thin_warning,
        }

    except Exception as e:
        err = str(e)
        if '429' in err or 'rate_limit' in err.lower():
            return {"error": "The research service is busy. Wait 30 seconds and try again.", "brief": brief}
        return {"error": f"Research error: {err}", "brief": brief}

# ── Full brief assembly — three LLM calls, 70b for reasoning ──────────────────
def run_full_brief_assembly(brief, answers):
    brief = dict(brief)

    # Build answers context — Q1-Q4 only, raw words preserved
    q_parts = []
    q_labels = {
        'q1': 'What drew them to this role',
        'q2': 'Moment they are proud of that CV does not capture',
        'q3': 'Hardest thing they have accomplished',
        'q4': 'Anything in their background worth contextualising',
    }
    for key, label in q_labels.items():
        val = answers.get(key, '').strip()
        if val:
            q_parts.append(f"{label}:\n{val}")

    answers_context = ""
    if q_parts:
        answers_context = (
            "CANDIDATE'S OWN WORDS — these are primary signal.\n"
            "Mine these for specific phrases, instincts, and ways of seeing.\n"
            "The best lines in the cover letter are often already here.\n\n"
            + "\n\n".join(q_parts)
        )

    anything_missed = answers.get('anything_missed', '').strip()
    pain_str = "\n".join(brief.get('selected_pain_points', []))

    # Get parsed CV data if available
    parsed_cv = brief.get('parsed_cv', {})
    cv_summary = ""
    if parsed_cv:
        cv_summary = f"""PARSED CV STRUCTURE:
Current role: {parsed_cv.get('current_role', '')}
Career arc: {parsed_cv.get('career_arc', '')}
Top achievement 1: {parsed_cv.get('top_achievement_1', '')}
Top achievement 2: {parsed_cv.get('top_achievement_2', '')}
Top achievement 3: {parsed_cv.get('top_achievement_3', '')}
All metrics: {parsed_cv.get('all_metrics', '')}
Strongest skill: {parsed_cv.get('strongest_skill', '')}
Undersold signals: {parsed_cv.get('undersold_signals', '')}
Career transitions: {parsed_cv.get('career_transitions', '')}
Gaps in timeline: {parsed_cv.get('gaps_in_timeline', '')}"""
    else:
        cv_summary = f"CV TEXT:\n{brief.get('cv_text','')[:2500]}"

    # P1 — Signal extraction — Groq 70b
    # Extracts structured signals from CV + answers
    try:
        p1 = llm(
            f"""{LEVEL_1}

YOUR TASK:
Extract the precise signals that will drive every asset in this pipeline.

WHY THIS MATTERS:
These extracted signals are what the cover letter, bullets, and interview
prep are built from. Extraction that inflates or generalises produces
assets that feel generic. Extraction that is specific and honest produces
assets that feel real.

PRIMARY INPUT — weight the candidate's own words most heavily:
If the candidate has answered the questions below, their exact phrasing
contains the raw material for the cover letter's most authentic moments.
Extract it precisely — do not paraphrase away the specificity.

{answers_context if answers_context else "CANDIDATE'S OWN WORDS: None provided. Extract from CV only."}

SECONDARY INPUT — CV evidence:
{cv_summary}

ROLE CONTEXT:
JD: {brief.get('jd_text','')[:1500]}
Pain points selected: {pain_str}
Core problem: {brief.get('core_problem','')}
Must-have signals: {brief.get('must_have_signals','')}

[Optional inputs above — if any are empty, extract from what exists.
Do not infer or fabricate where evidence is absent.]

Output EXACTLY these fields, no preamble, no markdown:
CURRENT_ROLE: [title + company + tenure]
TOP_ACHIEVEMENT_1: [most specific — metric + mechanism + context]
TOP_ACHIEVEMENT_2: [second strongest — same standard]
TOP_ACHIEVEMENT_3: [third — same standard]
STRONGEST_SKILL: [one capability most consistently demonstrated]
UNDERSOLD_QUALITY: [strong but underwritten in CV — NONE_DETECTED if absent]
CAREER_NARRATIVE: [one sentence through-line connecting roles]
REFRAME_NEEDED: [gap or pivot needing confident framing — NONE if absent]
CANDIDATE_VOICE_SIGNAL: [most distinctive phrase from candidate's own words — NONE if no answers]""",
            max_tokens=700, quality="high"
        )
        for field in ['CURRENT_ROLE','TOP_ACHIEVEMENT_1','TOP_ACHIEVEMENT_2','TOP_ACHIEVEMENT_3',
                      'STRONGEST_SKILL','UNDERSOLD_QUALITY','CAREER_NARRATIVE',
                      'REFRAME_NEEDED','CANDIDATE_VOICE_SIGNAL']:
            brief[field.lower()] = parse_field(p1, field)
    except Exception as e:
        print(f"Brief P1 error: {e}")

    time.sleep(1.5)

    # P2 — Narrative thread — Groq 70b
    # The single most important output of the brief assembly.
    # This becomes the spine of the cover letter.
    try:
        p2 = llm(
            f"""{LEVEL_1}

YOUR TASK:
Find the single argument this application must make.

WHY THIS MATTERS:
The narrative thread is the spine of everything built after this.
The cover letter argues it. The bullets prove it. The interview prep
reinforces it. Get this wrong and everything built on top of it is wrong.

The narrative thread is not a summary of the candidate's career.
It is the precise intersection of what this candidate has genuinely
demonstrated and what this company most urgently needs.
It is one sentence that a recruiter reads and thinks:
"This is exactly what we need, and this person has done it."

CANDIDATE SIGNALS:
Current role: {brief.get('current_role','')}
Achievement 1: {brief.get('top_achievement_1','')}
Achievement 2: {brief.get('top_achievement_2','')}
Achievement 3: {brief.get('top_achievement_3','')}
Strongest skill: {brief.get('strongest_skill','')}
Career narrative: {brief.get('career_narrative','')}
Undersold quality: {brief.get('undersold_quality','')}
Candidate's own voice signal: {brief.get('candidate_voice_signal','')}

OPPORTUNITY SIGNALS:
Company: {brief.get('company','')}
Role: {brief.get('job_title','')}
Core problem: {brief.get('core_problem','')}
Pain points selected: {pain_str}
Must-have signals: {brief.get('must_have_signals','')}
Strategic context: {brief.get('strategic_context','')}

CANDIDATE'S OWN WORDS:
{answers_context if answers_context else "None provided."}

ANYTHING MISSED:
{anything_missed if anything_missed else "None provided."}

[All optional inputs above — if empty, work from what exists.
Never fabricate signals. If evidence is genuinely thin, produce
what is honest rather than what sounds impressive.]

Output EXACTLY these fields, no preamble, no markdown:
STRONGEST_OVERLAP: [precise intersection — what this candidate has that this role needs]
STRATEGIC_ANGLE: [how to position this candidate — the single sharpest argument]
NARRATIVE_THREAD: [one sentence — the argument every asset makes]
COMPANY_HOOK: [most specific observation about this company — for P3 and cold email]
GAPS_TO_ADDRESS: [1-2 genuine gaps — honest, specific — NONE if absent]
GAPS_TO_AVOID: [claims that outrun the evidence — NONE if absent]
TONE_DIRECTION: [specific voice guidance based on candidate's words and situation]""",
            max_tokens=700, quality="high"
        )
        for field in ['STRONGEST_OVERLAP','STRATEGIC_ANGLE','NARRATIVE_THREAD',
                      'COMPANY_HOOK','GAPS_TO_ADDRESS','GAPS_TO_AVOID','TONE_DIRECTION']:
            brief[field.lower()] = parse_field(p2, field)
    except Exception as e:
        print(f"Brief P2 error: {e}")

    time.sleep(1.5)

    # P3 — Gap analysis — Groq 70b
    try:
        gap_analysis = llm(
            f"""{LEVEL_1}

YOUR TASK:
Produce an honest gap analysis for this application.

Be precise. Be honest. Do not soften genuine gaps.
Do not inflate genuine strengths beyond what the evidence supports.
The candidate reads this before approving the brief.
They need the truth, not reassurance.

Pain points: {pain_str}
Strategic angle: {brief.get('strategic_angle','')}
Narrative thread: {brief.get('narrative_thread','')}
Gaps identified: {brief.get('gaps_to_address','')}
CV evidence:
{cv_summary[:1500]}
JD: {brief.get('jd_text','')[:1200]}

Output:
**Matches**
- [match 1 — specific, not generic]
- [match 2]
- [match 3]

**Gaps**
- [gap 1 — honest, one line]
- [gap 2 — or NONE if no real gaps]

**Angle**
One sentence — the argument this application makes.

**Evidence strength**
For each pain point selected: Strong / Moderate / Weak — one line each.

**Application advice**
1-2 sentences. Honest. Specific to this candidate and role.""",
            max_tokens=600, quality="high"
        )
    except Exception as e:
        err = str(e)
        gap_analysis = ("The service is busy. Wait 30 seconds and try again."
                       if ('429' in err or 'rate_limit' in err.lower())
                       else f"Could not generate gap analysis: {err}")

    # Store answers directly in brief for generation prompts
    # New format: bullet_qa (per-bullet answers) + open_field replaces q1-q4
    brief['q1'] = ''  # removed — kept for backward compat with prompts
    brief['q2'] = ''
    brief['q3'] = ''
    brief['q4'] = ''
    brief['anything_missed'] = answers.get('anything_missed', answers.get('open_field', ''))
    brief['bullet_qa'] = answers.get('bullet_qa', {})

    return brief, gap_analysis

# ── Bullet diagnosis with targeted questions — Groq 70b ───────────────────────
def diagnose_bullets_with_questions(brief):
    """
    Selects 3-5 most improvable bullets from CV for this specific role.
    For each bullet with a gap, generates one targeted question typed to the
    specific gap: missing metric, missing mechanism, missing scope, or vague claim.
    Returns structured diagnosis with questions per bullet.
    """
    parsed_cv = brief.get('parsed_cv', {})
    cv_text = brief.get('cv_text', '')
    pain_str = "\n".join(brief.get('selected_pain_points', []))
    narrative = brief.get('narrative_thread', '')
    company = brief.get('company', '')
    job_title = brief.get('job_title', '')

    cv_for_prompt = ""
    if parsed_cv:
        cv_for_prompt = f"""PARSED CV:
Top achievement 1: {parsed_cv.get('top_achievement_1','')}
Top achievement 2: {parsed_cv.get('top_achievement_2','')}
Strongest skill: {parsed_cv.get('strongest_skill','')}
Undersold signals: {parsed_cv.get('undersold_signals','')}

FULL CV TEXT:
{cv_text[:3000]}"""
    else:
        cv_for_prompt = f"CV TEXT:\n{cv_text[:3000]}"

    try:
        result = llm(
            f"""{LEVEL_1}

YOUR TASK:
Select the 3 to 5 most improvable bullet points from this CV for this
specific role. Only select bullets that directly address one of the
selected pain points below — do not select bullets based on general
CV quality.

SELECTED PAIN POINTS — only select bullets that address these:
{pain_str if pain_str else "Select bullets most relevant to the role."}

WHY THIS MATTERS:
These bullets will be rewritten at generation using the candidate's
answers. The question you generate for each bullet must target the
precise gap between what the bullet currently says and what it needs
to say to address a pain point. One question per bullet — the most
valuable question only.

GAP TYPE CLASSIFICATION:
For each bullet that needs enrichment, identify its primary gap type:

MISSING_METRIC — the bullet describes an outcome without a number.
Question format: "For [specific thing] — do you have a number attached?
Even approximate — percentage, revenue figure, time saved, team size.
The mechanism matters more than precision."

MISSING_MECHANISM — the bullet states an outcome but not how.
Question format: "This bullet describes the result but not what you
specifically did to produce it. What was the decision or action that
made the difference here?"

MISSING_SCOPE — the bullet needs context to be evaluable.
Question format: "What was the scale of this — budget, number of accounts,
users, inherited conditions — that gives this result its full weight?"

VAGUE_CLAIM — the bullet uses language that could apply to any candidate.
Question format: "This describes something many people could claim.
What specifically did you do here that someone else in your role
wouldn't have done?"

NARRATIVE THREAD: {narrative}
ROLE: {job_title} at {company}
PAIN POINTS:
{pain_str}

{cv_for_prompt}

JD: {brief.get('jd_text','')[:1200]}

SELECTION CRITERIA:
- Must select minimum 3, maximum 5 bullets
- Prioritise bullets where real evidence exists to improve them
- At least half should be NEEDS_ENRICHMENT — if the CV is strong,
  still select the 3 most improvable bullets even if they are good
- Never select the same bullet twice

For EACH selected bullet output EXACTLY:

ROLE: [job title and company this bullet is from]
BULLET: [exact text from CV]
RELEVANCE: [one sentence — why this bullet matters for this specific role,
tied to a specific pain point]
VERDICT: [STRONG / NEEDS_ENRICHMENT]
GAP_TYPE: [MISSING_METRIC / MISSING_MECHANISM / MISSING_SCOPE / VAGUE_CLAIM / NONE]
QUESTIONS: [if NEEDS_ENRICHMENT: exactly one targeted question typed to
the gap above. Specific, answerable, references the actual bullet text.
If STRONG: NONE]
---

After all bullets:
SUMMARY: [X selected, Y need enrichment]""",
            max_tokens=1200, quality="high"
        )
        return result
    except Exception as e:
        return f"Could not diagnose bullets: {str(e)}"

# ── Routing engine — LLM-recommended, candidate-confirmed ─────────────────────
def generate_routing_options(brief):
    company          = brief.get('company', 'this company')
    job_title        = brief.get('job_title', 'this role')
    ach1             = brief.get('top_achievement_1', '')
    ach2             = brief.get('top_achievement_2', '')
    narrative        = brief.get('career_narrative', '')
    reframe          = brief.get('reframe_needed', 'NONE')
    hook             = brief.get('company_hook', '')
    career_situation = brief.get('application_context', {}).get('career_situation', 'growing')
    referral_name    = brief.get('referral_name', '').strip()
    narrative_thread = brief.get('narrative_thread', '')
    strategic_angle  = brief.get('strategic_angle', '')

    opening_options = []

    if ach1:
        opening_options.append({
            "id": "lead_metric",
            "label": "Lead with your strongest result",
            "description": f"{ach1[:120]}{'...' if len(ach1) > 120 else ''}",
            "reasoning": "Evidence first. The result creates the question. The question earns P2.",
            "best_when": "Your evidence is specific and directly maps to this role's core pain point."
        })

    if reframe and reframe.upper() != 'NONE':
        opening_options.append({
            "id": "bridge",
            "label": "Bridge your background directly",
            "description": f"Name the transition confidently. Context: {reframe[:100]}",
            "reasoning": "Addressing a transition in P1 turns a potential concern into a demonstration of self-awareness.",
            "best_when": "You are changing industries, returning after a gap, or stepping up significantly."
        })

    if referral_name:
        opening_options.append({
            "id": "referral",
            "label": f"Open with {referral_name}'s referral",
            "description": f"Lead with {referral_name}'s name in the first sentence.",
            "reasoning": "A referral name changes how the entire letter is read before the first claim is processed.",
            "best_when": "You have a genuine connection at the company."
        })

    if ach2:
        opening_options.append({
            "id": "lead_story",
            "label": "Open with a specific moment",
            "description": f"{ach2[:120]}{'...' if len(ach2) > 120 else ''}",
            "reasoning": "When the thinking behind the result is more impressive than the result alone.",
            "best_when": "Your diagnostic process is the most convincing thing about this achievement."
        })

    if narrative_thread:
        opening_options.append({
            "id": "lead_narrative",
            "label": "Lead with your professional direction",
            "description": f"{narrative_thread[:120]}{'...' if len(narrative_thread) > 120 else ''}",
            "reasoning": "For roles where trajectory is the evidence — direction as compelling as any single metric.",
            "best_when": "Your career arc is itself the most relevant signal for this role."
        })

    # LLM recommendation — what actually serves the narrative thread best
    best_opening = opening_options[0]["id"] if opening_options else "lead_metric"
    if referral_name:
        best_opening = "referral"
    elif career_situation in ["pivot", "gap"] and any(o["id"] == "bridge" for o in opening_options):
        best_opening = "bridge"

    p3_options = []
    if hook and 'NONE' not in hook:
        p3_options.append({
            "id": "hook",
            "label": "Use a specific company observation",
            "description": f"{hook[:120]}{'...' if len(hook) > 120 else ''}",
            "reasoning": "Fewer than 5% of letters contain specific non-obvious company knowledge. This signals deliberate choice.",
            "best_when": "The observation connects to your professional direction."
        })

    p3_options.append({
        "id": "direction",
        "label": "Connect through your professional direction",
        "description": f"Written from where you want to take your work next, and why {company} is where that work happens.",
        "reasoning": "Honest and forward-looking beats flattery every time. Recruiters know the difference.",
        "best_when": f"You have a genuine sense of why {company} specifically."
    })

    p3_options.append({
        "id": "user_knowledge",
        "label": "Connect through firsthand knowledge",
        "description": f"If you have used {company}'s product or worked in their market — that specificity is personal.",
        "reasoning": "Personal connection to the product is one of the most memorable P3 approaches.",
        "best_when": f"You have been a {company} user, customer, or worked directly in their space."
    })

    best_p3 = p3_options[0]["id"]

    return {
        "opening_options": opening_options,
        "p3_options": p3_options,
        "recommended_opening": best_opening,
        "recommended_p3": best_p3,
    }

# ── Cover letter — chain-of-thought + generation + self-critique ───────────────
def build_cover_letter_prompt(brief, voice_instruction, routing_choices, application_context):
    company          = brief.get('company', 'this company')
    job_title        = brief.get('job_title', 'this role')
    pain_str         = "\n".join(brief.get('selected_pain_points', []))
    opening_approach = routing_choices.get('opening', 'lead_metric')
    p3_approach      = routing_choices.get('p3', 'direction')
    referral_name    = application_context.get('referral_name', '').strip()

    # Derive career situation from CV parsing
    career_transitions = brief.get('parsed_cv', {}).get('career_transitions', '') or brief.get('reframe_needed', '')
    is_transition = career_transitions and career_transitions.upper() not in ['NONE', '']

    # P1 instruction — routing-aware
    if opening_approach == 'referral' and referral_name:
        p1_instruction = f"""P1 — REFERRAL OPENING:
{referral_name} referred this candidate. Their name belongs in the first sentence naturally — not announced, woven in.
After the referral: the candidate's strongest relevant evidence.
The referral is the opening move. A warm introduction, not a credential.
Role appears where it fits naturally — not as a separate announcement."""

    elif opening_approach == 'bridge':
        reframe = brief.get('reframe_needed', '')
        p1_instruction = f"""P1 — BRIDGE OPENING:
This candidate is making a transition. Context: {reframe}
Open with the strongest evidence FIRST — not an explanation of the transition.
Then name the gap directly and bridge it confidently in the same paragraph.
The bridge sentence: "The industry was X, not Y — but the dynamics were identical."
Or: "The context changes. The skill does not."
NEVER frame the transition as a deficit. Frame it as context that makes the evidence more interesting.
The recruiter should finish P1 thinking: "This person understands exactly what transfers and why." """

    elif opening_approach == 'lead_story':
        p1_instruction = f"""P1 — DIAGNOSTIC MOMENT:
Open with a specific moment — a situation that required non-obvious thinking.
The moment is the hook. What the candidate saw that others did not.
The result follows from the insight — not the other way around.
Role appears after the hook, once the evidence has earned it."""

    elif opening_approach == 'lead_narrative':
        p1_instruction = f"""P1 — PROFESSIONAL DIRECTION:
Open with the candidate's professional through-line — where they are headed and why.
The direction is specific, not aspirational. It connects to this role's core purpose.
Evidence follows immediately — direction without evidence is just ambition.
The recruiter should finish P1 thinking: "This person knows exactly what they are doing." """

    else:  # lead_metric — default
        p1_instruction = f"""P1 — EVIDENCE OPENING:
Open with the candidate's single strongest result that maps to {job_title} at {company}.
Two to three sentences maximum. Lead with the result. Complicate it immediately.
The counterintuitive element ("not by doing X, but by doing Y") makes the recruiter lean in.
The recruiter's question after P1 must be: "How did they do that?" Not "So what?"
Weave the role name in naturally — do not announce it as a separate sentence.
NEVER: excitement, company's challenges, statements that apply to any candidate."""

    # P3 instruction — routing-aware
    if p3_approach == 'hook' and brief.get('company_hook') and 'NONE' not in brief.get('company_hook',''):
        p3_instruction = f"""P3 — SPECIFIC COMPANY OBSERVATION:
Use this researched detail: {brief.get('company_hook', '')}
Write from the candidate's perspective — why THIS detail connects to where they want to take their work.
2 sentences. Not flattery. Not briefing {company} on their own business.
Test: could this only be written by someone who actually paid attention to {company}?"""

    elif p3_approach == 'user_knowledge':
        p3_instruction = f"""P3 — FIRSTHAND KNOWLEDGE:
Write from personal experience with {company}'s product, market, or work.
Specific and real — not researched to impress. The connection must feel lived.
2 sentences. Specific beats general every time."""

    else:  # direction — default
        p3_instruction = f"""P3 — PROFESSIONAL DIRECTION:
Write from where the candidate wants to take their work next, and why {company} is where that work happens.
Honest and forward-looking. Not: "{company} is a leader in..." Not: "I am excited about..."
2 sentences from the candidate's professional direction outward.
Test: does this sound like it could only be written by this specific candidate?"""

    # Gap handling — honest, not defensive
    gap_instruction = ""
    gaps = brief.get('gaps_to_address', '')
    if gaps and gaps.upper() not in ['NONE', '']:
        gap_instruction = f"""
GAP HANDLING:
Genuine gap identified: {gaps}
Address it in one sentence — confident, not apologetic, not over-explained.
Half a sentence to name it. One sentence to reframe it. Move on.
Place it where it fits the flow — do not make it the focus."""

    # Stage register — derived from research
    company_stage = brief.get('company_stage_derived', '')
    stage_note = ""
    if company_stage == 'early_startup':
        stage_note = "REGISTER: Early-stage company. Direct, less formal. Peer conversation. Emphasis on ownership and building."
    elif company_stage == 'mnc':
        stage_note = "REGISTER: Large MNC. More formal. Evidence should include scale, process, and institutional impact."
    elif company_stage == 'growth':
        stage_note = "REGISTER: Growth-stage. Balance startup directness with enterprise credibility."

    return f"""{LEVEL_1}

YOUR TASK:
Write a cover letter for this candidate applying for {job_title} at {company}.

LEVEL 2 PURPOSE:
The cover letter is the first place the hiring manager forms an opinion
about whether this candidate thinks at the level the role requires.
A letter that argues precisely — using real evidence, connected to real
company needs — creates the impression that the candidate already
understands the role. That impression determines whether there is a
conversation.

This is not a summary of the CV. It is an argument made to a specific
reader about whether this candidate can solve the problems this role
exists to solve.

WHAT HAS BEEN BUILT BEFORE THIS:
The candidate's CV has been parsed in full. The company has been
researched across four dimensions. Two pain points have been confirmed
by the candidate. A narrative thread has been derived. The candidate
has shared, in their own words, what drew them to this role and what
they are most proud of.

{FEW_SHOT_EXAMPLES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1 — STRUCTURED SCRATCHPAD (complete all six slots before writing prose)

These slots are internal commitment — not part of the output.
Fill them in sequence. Each slot constrains what you may write in the letter.
If a slot cannot be filled from the brief, the letter cannot be written well.

Output the scratchpad in this exact format, then write the letter below it.

SLOT_1_ARGUMENT: [One sentence only. The specific claim this letter argues —
why this candidate belongs in this role at this company. Not a summary of
qualifications. A claim that could be argued, tested, and potentially rejected.
If this sounds like it could apply to another candidate, rewrite it.]

SLOT_2_COMPANY_OBSERVATION: [One or two sentences. What specific thing does
this candidate understand about {company}'s current situation that someone
who hadn't thought about them wouldn't know? Draw ONLY from the research
in the brief — pain points, hiring moment, strategic context, Tavily findings.
Not from the careers page or job description. If this could apply to three
other companies in the same industry, it has failed this slot.]

SLOT_3_BIOGRAPHICAL_THREAD: [One sentence. The specific moment or pattern
in this candidate's history that makes this application feel inevitable rather
than opportunistic. Name the moment — not the skill it demonstrates.
"Strong analytical skills" = failed. "The pricing model rebuild where the
CFO's assumptions turned out to be wrong" = passed.]

SLOT_4_EVIDENCE_ANCHOR: [One sentence. The single strongest piece of evidence
in the brief — one metric, one outcome, one result — that the letter must
contain. Commit now. This cannot be omitted during prose because flow felt
better without it.]

SLOT_5_HONEST_TEXTURE: [One sentence. The one thing this candidate could say
that only they could say — specific to their history, motivation, or reading
of this opportunity. No other candidate could write this sentence. If it could
appear in any motivated candidate's letter, it has failed this slot.]

SLOT_6_PARAGRAPH_MAP: [Four lines — one per paragraph. Each line names what
work that paragraph performs in the argument, not what it says. Format:
P1: [tension it opens]
P2: [tension it resolves + new tension it creates]
P3: [how it earns the company connection without flattery]
P4: [why it is the only logical conclusion given P1-P3]
If any line says "summarises background" or "expresses enthusiasm" —
that paragraph has not earned its place. Rewrite the map line.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 2 — PROSE (write only after all six slots are filled)

Write from the slots. They are commitments, not suggestions.
The prose must deliver what each slot promised.

INPUTS — in order of how they should inform the letter:

NARRATIVE THREAD — let this drive every paragraph:
{brief.get('narrative_thread', '')}
[If empty: derive from the strongest overlap below]

SELECTED PAIN POINTS — what the letter argues this candidate solves:
{pain_str}
[These will always be present]

CANDIDATE'S OWN WORDS — mine these first for voice and specific phrases:
What drew them to this role: {brief.get('q1', '')}
Moment they are proud of: {brief.get('q2', '')}
Hardest thing accomplished: {brief.get('q3', '')}
Context to know: {brief.get('q4', '')}
Anything missed: {brief.get('anything_missed', '')}
[All optional — if empty, continue with same precision from evidence below]

TOP ACHIEVEMENTS — use specific evidence, exact mechanisms:
Achievement 1: {brief.get('top_achievement_1', '')}
Achievement 2: {brief.get('top_achievement_2', '')}
Achievement 3: {brief.get('top_achievement_3', '')}
[Use numbers and mechanisms exactly as stated. Do not round or approximate.]

COMPANY INTELLIGENCE — for P3:
Strategic context: {brief.get('strategic_context', '')}
Cultural reality: {brief.get('culture_reality', '')}
Company hook: {brief.get('company_hook', '')}
[Use for P3 only. Never brief the company on their own business.]

STRATEGIC ANGLE: {brief.get('strategic_angle', '')}
STRONGEST OVERLAP: {brief.get('strongest_overlap', '')}
CANDIDATE VOICE SIGNAL: {brief.get('candidate_voice_signal', '')}

RAW CV (for evidence not captured above):
{brief.get('cv_text', '')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOUR PARAGRAPH STRUCTURE:

{p1_instruction}

P2 — THE PROOF:
One specific moment that makes P1 credible. Not a list — one moment.
Three-beat rhythm: short sentence (situation) → longer sentence
(diagnosis + action + mechanism) → short sentence (result).
The thinking behind the decision is the evidence — not the outcome alone.
One metric. One sentence of context for it — scope before scale.
The recruiter should think: "I want this person looking at our problems."

{p3_instruction}

P4 — THE CLOSE:
Assumes the conversation is happening. Specifies a day or window.
One or two sentences. Nothing after.
NEVER: "I look forward to hearing from you" / "I hope to have the opportunity"
NEVER: "Thank you for your time" / "Please find attached"

{gap_instruction}

{stage_note}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{VOICE_REGISTER}

{voice_instruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ABSOLUTE CONSTRAINTS:
- Never open with I
- Never open any paragraph with I
- Total letter: 180-280 words (scratchpad does not count toward word count)
- No sentence longer than 25 words
- No claims without evidence in the letter itself

SELF-CHECK before outputting the letter:
1. Does the letter deliver what SLOT_1_ARGUMENT committed to?
2. Does SLOT_2_COMPANY_OBSERVATION appear in the letter — earned, not stated?
3. Does SLOT_3_BIOGRAPHICAL_THREAD make the application feel inevitable?
4. Is SLOT_4_EVIDENCE_ANCHOR present with its mechanism intact?
5. Does SLOT_5_HONEST_TEXTURE survive — could only this candidate write it?
6. Does each paragraph do the work named in SLOT_6_PARAGRAPH_MAP?
7. Rhythm: no three sentences the same length in a row?
8. Does it sound like a specific human wrote this, for this role, today?

Output format:
[SCRATCHPAD]
SLOT_1_ARGUMENT: ...
SLOT_2_COMPANY_OBSERVATION: ...
SLOT_3_BIOGRAPHICAL_THREAD: ...
SLOT_4_EVIDENCE_ANCHOR: ...
SLOT_5_HONEST_TEXTURE: ...
SLOT_6_PARAGRAPH_MAP:
P1: ...
P2: ...
P3: ...
P4: ...
[/SCRATCHPAD]

[LETTER]
[Four paragraphs. No preamble. No commentary.]
[/LETTER]"""

def generate_cover_letter(brief, voice_instruction, routing_choices=None, application_context=None):
    rc  = routing_choices or {}
    ctx = application_context or {}

    prompt = build_cover_letter_prompt(brief, voice_instruction, rc, ctx)

    # ── Generation: Gemini 2.5 Flash ──────────────────────────────────────────
    # Flash generates the letter with six-slot scratchpad.
    # Higher temperature (0.75) for prose naturalness — the scratchpad keeps
    # it from drifting into generic territory despite the higher temperature.
    raw = llm_gemini(prompt, max_tokens=1600, model=MODEL_GEMINI_FLASH, temperature=0.75)

    # ── Extract letter from scratchpad output ──────────────────────────────────
    # The model outputs [SCRATCHPAD]...[/SCRATCHPAD][LETTER]...[/LETTER]
    # Extract each section cleanly.
    scratchpad = ""
    letter_text = raw

    scratchpad_match = re.search(r'\[SCRATCHPAD\](.*?)\[/SCRATCHPAD\]', raw, re.DOTALL)
    letter_match     = re.search(r'\[LETTER\](.*?)\[/LETTER\]', raw, re.DOTALL)

    if scratchpad_match:
        scratchpad = scratchpad_match.group(1).strip()
    if letter_match:
        letter_text = letter_match.group(1).strip()
    else:
        # Fallback: if tags not present, try to split on double newline after scratchpad
        # and take everything after as the letter
        if scratchpad_match:
            after_scratchpad = raw[scratchpad_match.end():].strip()
            letter_text = after_scratchpad if after_scratchpad else raw

    text = letter_text.strip()

    # ── Adversarial Judge: Gemini 2.5 Pro ─────────────────────────────────────
    # Cross-model critique — Pro evaluates what Flash produced.
    # Pro has different training priors than Flash; it notices different failures.
    # The judge evaluates against five criteria: 75% recruiter, 25% editorial.
    # It compares the letter against the scratchpad commitments.
    # Returns structured verdict: PASS / REVISE / REJECT with precise signal.
    judge_verdict = "PASS"
    judge_signal  = ""
    judge_revision_instruction = ""

    company   = brief.get('company', 'this company')
    job_title = brief.get('job_title', 'this role')

    try:
        judge_prompt = f"""{LEVEL_1}

YOUR TASK:
You are a senior recruiter who has read over 500 cover letters for roles
like {job_title}. You are also a rigorous editor who cannot be fooled by
polished prose that contains no substance.

Evaluate this cover letter against five criteria.
You have access to the full brief and the writer's own scratchpad commitments.
Your job is adversarial — find what fails, name it precisely.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE BRIEF (what the candidate actually has):
Company: {company}
Role: {job_title}
Narrative thread: {brief.get('narrative_thread', '')}
Pain points: {chr(10).join(brief.get('selected_pain_points', []))}
Achievement 1: {brief.get('top_achievement_1', '')}
Achievement 2: {brief.get('top_achievement_2', '')}
Company hook / research: {brief.get('company_hook', '')}
Strategic context: {brief.get('strategic_context', '')}
Candidate's own words (q1-q4): {brief.get('q1','')} / {brief.get('q2','')} / {brief.get('q3','')} / {brief.get('q4','')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE WRITER'S SCRATCHPAD COMMITMENTS:
{scratchpad if scratchpad else "[Scratchpad not available — evaluate letter against brief only]"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE COVER LETTER:
{text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION CRITERIA:

CRITERION 1 — GENUINE COMPANY UNDERSTANDING (recruiter, 20%)
Does the letter demonstrate something specific about {company}'s situation
that a candidate who hadn't thought carefully about them wouldn't know?
Not a careers-page fact — an inference, an observation, a reading of their moment.
Could this P3 appear in a letter to three other companies in the same industry?
If yes: FAIL. If no — it is earned: PASS.
Also check: does the letter deliver what SLOT_2_COMPANY_OBSERVATION committed to?

CRITERION 2 — BIOGRAPHICAL INEVITABILITY (recruiter, 20%)
Does the candidate's history create a felt logic toward this role —
not a stated one? Does the reader finish and think "of course"
or "sounds reasonable"? "Sounds reasonable" is a FAIL.
Is the connection argued through specific evidence, or merely asserted?
Pure assertion with no evidence trail: REVISE. No causal thread at all: REJECT.
Also check: does the letter use SLOT_3_BIOGRAPHICAL_THREAD?

CRITERION 3 — VOICE NATURALNESS (recruiter, 20%)
Three sub-signals:
(a) Sentence rhythm — does length vary meaningfully across paragraphs?
(b) Unexpected phrasing — at least one word choice or construction that
    professional-register optimisation alone would not produce?
(c) Tonal consistency — does the voice feel like one person throughout,
    or does it shift register between paragraphs?
If uniformly smooth, every sentence the same weight and length: REVISE.
Name the specific paragraph that is most mechanical.

CRITERION 4 — EMOTIONAL HONESTY (recruiter, 15%)
Is there one moment where the candidate sounds like a person rather than
a professional document? An honest motivation, an acknowledged tension,
a reason specific to them. Not "I am passionate about X." Not generic ambition.
Something only this candidate could mean.
Absent entirely: REVISE. Replaced by formulaic passion language: REVISE
(formulaic is worse than absence — it signals awareness of the gap
filled with the wrong thing).
Also check: does the letter deliver SLOT_5_HONEST_TEXTURE?

CRITERION 5 — EVIDENCE INTEGRITY (editorial, 25%)
Classify every specific claim in the letter:
GROUNDED: directly traceable to brief, proportionate to evidence
INFLATED: traceable but overstated relative to what the brief supports
FABRICATED: no basis in the brief at all
FABRICATED = automatic REJECT regardless of other criteria performance.
INFLATED = REVISE with specific deflation instruction.
Also check: is SLOT_4_EVIDENCE_ANCHOR present in the letter with its mechanism?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT LOGIC:

PASS if:
- No FABRICATED claims
- Criteria 1, 2, 3 all PASS
- No more than one REVISE signal, and only on criterion 4

REVISE if:
- One or two REVISE signals on criteria 2, 3, or 4
- No REJECT signals
- No FABRICATED claims

REJECT if:
- Any FABRICATED claim
- REJECT signal on criterion 1 (no earned company understanding)
- REJECT signal on criterion 2 (no causal thread — pure credential assembly)
- Three or more REVISE signals across any criteria

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Output EXACTLY this format — no preamble, no commentary:

VERDICT: [PASS|REVISE|REJECT]

C1_COMPANY_UNDERSTANDING: [PASS|FAIL] — [one sentence if FAIL]
C2_BIOGRAPHICAL_INEVITABILITY: [PASS|REVISE|REJECT] — [one sentence if not PASS]
C3_VOICE_NATURALNESS: [PASS|REVISE] — [specific paragraph if REVISE]
C4_EMOTIONAL_HONESTY: [PASS|REVISE] — [one sentence if REVISE]
C5_EVIDENCE_INTEGRITY: [PASS|REVISE|REJECT] — [list any INFLATED or FABRICATED claims]

REVISION_INSTRUCTION: [If REVISE: one surgical instruction — which paragraph, what changes, what specific brief material to use. If PASS or REJECT: NONE]

REJECTION_SIGNAL: [If REJECT: three things — (1) the specific failure as a prohibition, (2) the brief material that was available but unused, (3) the argument structure pre-solved. If PASS or REVISE: NONE]"""

        judge_raw = llm_gemini(
            judge_prompt,
            max_tokens=600,
            model=MODEL_GEMINI_PRO,
            temperature=0.2   # Low temperature — judge must be consistent and precise
        )

        # Parse verdict
        verdict_match = re.search(r'VERDICT:\s*(PASS|REVISE|REJECT)', judge_raw, re.IGNORECASE)
        if verdict_match:
            judge_verdict = verdict_match.group(1).upper()

        revision_match  = re.search(r'REVISION_INSTRUCTION:\s*(.+?)(?=\nREJECTION_SIGNAL:|$)', judge_raw, re.DOTALL)
        rejection_match = re.search(r'REJECTION_SIGNAL:\s*(.+?)$', judge_raw, re.DOTALL)

        if revision_match:
            judge_signal = revision_match.group(1).strip()
        if rejection_match:
            judge_revision_instruction = rejection_match.group(1).strip()

        # ── Act on verdict ─────────────────────────────────────────────────────
        if judge_verdict == "REVISE" and judge_signal and judge_signal.upper() != "NONE":
            # Surgical revision pass — Flash executes against Pro's precise instruction
            revision_prompt = f"""{LEVEL_1}

YOUR TASK:
Make one targeted revision to this cover letter.
A cross-model evaluator has identified a specific problem.
Fix only what is named. Preserve everything that was not named.

EVALUATOR'S INSTRUCTION:
{judge_signal}

BRIEF CONTEXT (for revision):
Achievement 1: {brief.get('top_achievement_1', '')}
Achievement 2: {brief.get('top_achievement_2', '')}
Company hook: {brief.get('company_hook', '')}
Narrative thread: {brief.get('narrative_thread', '')}
Candidate voice (q1-q4): {brief.get('q1','')} / {brief.get('q2','')} / {brief.get('q3','')} / {brief.get('q4','')}

CURRENT LETTER:
{text}

{VOICE_REGISTER}

Constraints: 180-280 words. No paragraph opens with I.
Output ONLY the revised letter. Four paragraphs. No commentary."""

            text = llm_gemini(revision_prompt, max_tokens=1200, model=MODEL_GEMINI_FLASH, temperature=0.65)

        elif judge_verdict == "REJECT" and judge_revision_instruction and judge_revision_instruction.upper() != "NONE":
            # Full regeneration — with prohibition, missed material, and pre-solved structure
            regen_prompt = f"""{LEVEL_1}

YOUR TASK:
Write a new cover letter for {job_title} at {company}.
A previous attempt was evaluated and rejected. The rejection signal
tells you exactly what failed, what evidence was missed, and what
argument to make. Follow it precisely.

REJECTION SIGNAL FROM EVALUATOR:
{judge_revision_instruction}

{FEW_SHOT_EXAMPLES}

BRIEF:
Narrative thread: {brief.get('narrative_thread', '')}
Pain points: {chr(10).join(brief.get('selected_pain_points', []))}
Achievement 1: {brief.get('top_achievement_1', '')}
Achievement 2: {brief.get('top_achievement_2', '')}
Achievement 3: {brief.get('top_achievement_3', '')}
Company hook: {brief.get('company_hook', '')}
Strategic context: {brief.get('strategic_context', '')}
Candidate (q1-q4): {brief.get('q1','')} / {brief.get('q2','')} / {brief.get('q3','')} / {brief.get('q4','')}
Anything missed: {brief.get('anything_missed', '')}
CV: {brief.get('cv_text', '')[:2000]}

{VOICE_REGISTER}
{voice_instruction}

Constraints: 180-280 words. No paragraph opens with I. No sentence over 25 words.
Output ONLY the cover letter. Four paragraphs. No preamble."""

            text = llm_gemini(regen_prompt, max_tokens=1200, model=MODEL_GEMINI_FLASH, temperature=0.75)

    except Exception:
        # Judge failure is non-fatal — return original generated letter
        pass

    # ── Build letter_brief — decision record for refinement ───────────────────
    opening_labels = {
        'lead_metric':    'Led with strongest result',
        'bridge':         'Opened with bridge from background',
        'referral':       f"Opened with {ctx.get('referral_name','referral')}",
        'lead_story':     'Led with specific diagnostic moment',
        'lead_narrative': 'Led with professional direction',
    }
    p3_labels = {
        'hook':          'Used specific researched company observation',
        'direction':     'Connected through professional direction',
        'user_knowledge':'Connected through firsthand knowledge',
    }

    letter_brief = {
        "opening_approach": rc.get('opening', 'lead_metric'),
        "opening_label":    opening_labels.get(rc.get('opening','lead_metric'), 'Led with evidence'),
        "opening_evidence": brief.get('top_achievement_1',''),
        "argument":         brief.get('narrative_thread',''),
        "p3_approach":      rc.get('p3','direction'),
        "p3_label":         p3_labels.get(rc.get('p3','direction'), 'Connected through direction'),
        "gap_handled":      brief.get('gaps_to_address',''),
        "company":          brief.get('company',''),
        "job_title":        brief.get('job_title',''),
        "word_count":       len(text.split()),
        "judge_verdict":    judge_verdict,
    }

    return text, letter_brief

# ── Resume bullets — full rewrite, every selected bullet ──────────────────────
def generate_bullets(brief):
    """
    Rewrites every selected bullet for this specific role.
    Uses attributed Q&A from Step 3.5 and the full brief.
    Every bullet gets a rewrite — not just thin ones.
    """
    pain_str  = "\n".join(brief.get('selected_pain_points', []))
    cv_text   = brief.get('cv_text', '')
    jd_text   = brief.get('jd_text', '')
    narrative = brief.get('narrative_thread', '')
    anything_missed = brief.get('anything_missed', '')

    # Get attributed Q&A from Step 3.5
    bullet_qa = brief.get('bullet_qa', {})
    bullet_qa_text = ""
    if bullet_qa:
        for bullet_text, qa_pairs in bullet_qa.items():
            bullet_qa_text += f"\nBULLET: {bullet_text}\n"
            for q, a in qa_pairs.items():
                if a:
                    bullet_qa_text += f"Q: {q}\nA: {a}\n"

    if not cv_text or len(cv_text.strip()) < 50:
        return "ERROR: No CV text found. Please ensure your CV was loaded correctly."

    parsed_cv = brief.get('parsed_cv', {})
    cv_for_prompt = ""
    if parsed_cv:
        cv_for_prompt = f"""PARSED CV DATA:
All metrics in CV: {parsed_cv.get('all_metrics','')}
Undersold signals: {parsed_cv.get('undersold_signals','')}

FULL CV TEXT:
{cv_text[:3000]}"""
    else:
        cv_for_prompt = f"CV TEXT:\n{cv_text[:3000]}"

    prompt = f"""{LEVEL_1}

YOUR TASK:
Rewrite the selected resume bullets so that each one makes the
strongest possible argument for this specific candidate at this
specific role — using only evidence that is true and traceable
to their real experience.

LEVEL 2 PURPOSE:
The cover letter argues. The CV proves. These bullets are the
proof layer — the specific, verifiable evidence that makes the
cover letter's argument credible when the recruiter moves from
letter to CV.

A recruiter spends 6 seconds on a CV. They are not reading —
they are scanning for pattern interrupts. A bullet stops the eye
because it contains something specific that the generic bullets
around it do not. That specificity is what this rewrite must create.

Every selected bullet gets a rewrite — not just the weak ones.
A bullet can be well-written and still be the wrong argument for
this specific role. Every bullet is sharpened for this application.

WHAT EACH INPUT CONTRIBUTES:

NARRATIVE THREAD — every bullet should be legible as evidence
for this argument. A bullet that does not serve it should not
be in this selection.
{narrative if narrative else "[Not provided — use pain points as primary frame]"}

SELECTED PAIN POINTS — defines the reader's primary question.
Every bullet should answer: can this candidate solve this?
Use the exact language of the pain points naturally.
{pain_str}

STEP 3.5 ENRICHMENT — most valuable input for rewriting.
Real numbers and context the candidate confirmed as true.
Use these exactly. Never paraphrase or generalise them.
{bullet_qa_text if bullet_qa_text else "[None provided — rewrite from CV evidence only]"}

ANYTHING MISSED:
{anything_missed if anything_missed else "[None provided]"}

{cv_for_prompt}
JD: {jd_text[:1200]}

WHAT THIS ASSET ADDS THAT THE COVER LETTER CANNOT:
The cover letter argued: {narrative if narrative else "[see pain points]"}
These bullets do not restate that argument. They make it undeniable —
by giving the recruiter specific, verifiable evidence they can point
to when making the case internally for this candidate.
The cover letter persuades. The bullets prove.

REWRITING PRINCIPLES — these are ways of seeing, not rules to follow:

Each principle below describes what it does to the recruiter's eye.
Understand the effect first. Then apply the principle because you
understand why it works — not because it is on a list.

ONE — The first three words are the entire argument compressed.
A recruiter scanning a CV stops at the first thing they did not
predict. "Rebuilt pricing architecture" stops. "Led strategic
initiative" does not. Write the most specific thing first — then
prove it with what follows.

TWO — Claim and evidence inseparable.
Not "Did X, resulting in Y" — that construction tells the recruiter
the evidence is separate from the claim. Write so the mechanism and
outcome arrive together. The evidence IS the claim.

THREE — Mechanism with every metric.
"Revenue grew 40%" is unverifiable — the recruiter cannot evaluate
whether that was hard or easy, the market or the candidate.
The mechanism ("rebuilt the sales motion from transactional to
consultative") is the actual evidence. The metric is proof the
mechanism worked. Without the mechanism, the metric is just a number.

FOUR — Scope before scale.
Context that makes a metric evaluable comes before the metric.
Portfolio size, account value, team size, inherited conditions —
whatever gives the number meaning comes first.

FIVE — The diagnostic moment outperforms the outcome.
A bullet that shows what the candidate saw — the non-obvious diagnosis,
the decision no one else made — is more persuasive than a bullet that
shows what happened. Thinking is what the role requires. Show it.

SIX — Pass the "so what" test.
After every rewrite: does this bullet answer "so what" without the
reader needing to ask? If not, the bullet is not done.

SEVEN — Surface asymmetry.
If contribution was disproportionate to resources or position —
small team, no budget, inherited mess, compressed timeline —
that asymmetry is the most important thing to communicate.
"Led 3-person team to do what competitors needed 15 for" is more
memorable than any metric without its context.

EIGHT — Match approximate length.
The candidate's CV may be tightly formatted. One sentence is almost
always enough. Do not expand beyond the original bullet significantly.

NINE — Use pain point language naturally.
Incorporate JD vocabulary where it fits honestly — woven in, not listed.
The recruiter should recognise their own language in the bullet without
feeling it was inserted for their benefit.

TEN — Never invent.
If a metric is not in the CV or enrichment — do not use it.
The candidate will be asked about every bullet in an interview.
This is not a constraint on quality. It is what makes quality real.

WHAT THESE PRINCIPLES LOOK LIKE IN PRACTICE:
Three transformations — before and after — so you feel the difference,
not just understand the rule. Each is a single sentence.

TRANSFORMATION 1 — Specificity first
BEFORE: Led strategic initiative to improve enterprise retention,
driving significant revenue impact.
AFTER: Rebuilt renewal outreach for 23 enterprise accounts ($800K avg
ARR) from 60 to 180 days pre-renewal — churn dropped from 18% to 6%.
WHAT CHANGED: First three words name a real action on a real thing.
The recruiter's eye stops because it cannot predict what follows.
Everything after is made credible by where the bullet started.

TRANSFORMATION 2 — Mechanism with the metric
BEFORE: Increased sales revenue by 40% year-over-year.
AFTER: Rebuilt sales motion from transactional to consultative —
led with business case before product demo — deal size grew from
$12K to $31K, revenue up 40% YoY.
WHAT CHANGED: "Revenue up 40%" alone is unverifiable. The mechanism
is the actual evidence. The metric is proof the mechanism worked.
Without the mechanism, the metric is just a number.

TRANSFORMATION 3 — The diagnostic moment
BEFORE: Managed product analytics and improved key conversion metrics
through data-driven optimisation.
AFTER: Noticed activation metric was measuring day-1 logins not first
meaningful action — reset baseline, found three friction points,
activation moved from 34% to 61% in one quarter.
WHAT CHANGED: "Managed product analytics" describes a function.
"Noticed the metric was measuring the wrong thing" describes a
diagnostic. The recruiter learns how this person thinks, not just
what they did. Thinking is what the role requires.

BANNED VOCABULARY:
spearheaded · leveraged · synergised · managed stakeholders
drove alignment · led cross-functional efforts ·
delivered impactful solutions · achieved results ·
executed initiatives · responsible for · worked on ·
contributed to · helped to

WHAT GOOD LOOKS LIKE:
A recruiter reads the bullet and thinks: "This person has done
exactly what I need done." Not "this person seems capable."
The specific claim makes the specific capability undeniable.

OUTPUT FORMAT — for each bullet:
ORIGINAL: [exact original text]
REWRITTEN: [sharpened bullet — one sentence, specific]
ARGUES: [one line — what capability this proves for this role]
---

After all bullets:
SUMMARY: [X bullets, what they collectively argue]"""

    try:
        result = llm(prompt, max_tokens=1200, quality="high")
        return result
    except Exception as e:
        return f"Could not generate bullets: {str(e)}"

# ── Interview prep — with company research and expert frameworks ───────────────
def generate_interview_prep(brief):
    pain_str = "\n".join(brief.get('selected_pain_points', []))
    company  = brief.get('company', 'this company')
    job_title = brief.get('job_title', 'this role')

    # Company interview research from Tavily
    interview_research = brief.get('interview_process', '')
    culture_reality    = brief.get('culture_reality', '')

    interview_section = ""
    if interview_research and len(interview_research.strip()) > 50:
        interview_section = f"""COMPANY INTERVIEW RESEARCH — from credible sources:
{interview_research[:800]}
[Source: Glassdoor, Reddit, LinkedIn accounts of people who interviewed at {company}]
Use this to generate questions that reflect what this company actually asks."""
    else:
        interview_section = f"""COMPANY INTERVIEW RESEARCH: No specific process data found for {company}.
Preparation below is built from expert recruiter and interviewer insights applied
to this role type and company stage — not from company-specific data.
Treat it as strong general preparation rather than company-specific intelligence."""

    prompt = f"""{LEVEL_1}

YOUR TASK:
Build a complete, company-specific interview preparation guide
for this candidate applying for {job_title} at {company}.

LEVEL 2 PURPOSE:
The cover letter and CV get the candidate the interview.
This preparation is what converts the interview into an offer.

An interview is not an exam with right answers. It is a conversation
in which the interviewer is trying to answer one question: is this
person going to be able to do this work, in this environment,
with these people?

Everything in this guide serves that question. Not "how do I answer
this" — "how do I help this interviewer see clearly that the answer
is yes."

WHAT THIS ASSET ADDS THAT THE COVER LETTER CANNOT:
The cover letter made the argument. The interview is where that
argument is tested under questioning. Every answer in this guide
should be traceable back to the narrative thread — not because
the candidate is repeating the letter, but because they are
defending the same claim from a different position.

CRITICAL DISTINCTION:
Do not produce scripted model answers. Produce thinking frameworks.
An interviewer recognises a memorised answer before they process
its content. The best interview answers feel like the candidate
is thinking out loud — not delivering something prepared.
The structure is there, but invisible.

WHAT EACH INPUT CONTRIBUTES:

NARRATIVE THREAD — every answer should be traceable to this.
When in doubt about how to frame anything, return to the thread.
{brief.get('narrative_thread','')}
[Optional — if empty, use strategic angle as primary frame]

STRATEGIC ANGLE: {brief.get('strategic_angle','')}

SELECTED PAIN POINTS — the interview will probe whether the candidate
can solve these. Every story should demonstrate capability against
at least one.
{pain_str}

CANDIDATE EVIDENCE — use only what is confirmed as true here.
If evidence is thin for a question type, say so and suggest
what the candidate should reflect on before the interview.
Achievement 1: {brief.get('top_achievement_1','')}
Achievement 2: {brief.get('top_achievement_2','')}
Achievement 3: {brief.get('top_achievement_3','')}
Strongest skill: {brief.get('strongest_skill','')}
Career narrative: {brief.get('career_narrative','')}
Gaps to address: {brief.get('gaps_to_address','')}
Q1 — what drew them here: {brief.get('q1','')}
Q2 — proud moment: {brief.get('q2','')}
Q3 — hardest thing: {brief.get('q3','')}
Q4 — context to know: {brief.get('q4','')}
Anything missed: {brief.get('anything_missed','')}
[All optional — if empty, note and work from what exists]

COMPANY INTELLIGENCE — for calibrating tone and emphasis.
Cultural reality is the most important for understanding
what this company rewards in interviews.
Strategic context: {brief.get('strategic_context','')}
Cultural reality: {culture_reality}
Core problem: {brief.get('core_problem','')}
Must-have signals: {brief.get('must_have_signals','')}
[Optional — if thin, note the limitation]

{interview_section}

OUTPUT — build exactly this structure:

━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — THE FIRST 4 MINUTES
━━━━━━━━━━━━━━━━━━━━━━━━━━
Research shows interview decisions are often made in the first
4 minutes. This section covers what happens before the first
formal question.

OPENING STATEMENT:
How this candidate should introduce themselves in 60-90 seconds.
Not a CV summary — a professional argument. Written in their voice.

Three things in this order:
What this candidate has consistently figured out that others have not —
the diagnostic instinct or capability that runs through their work.
One specific moment that proves it — not a job title, an observation.
Why this role is the next place that thinking is most needed.

The interviewer should finish the opening thinking:
"This person knows exactly what they do and why it matters here."
Not "impressive background." Knowing.

Write this specifically for this candidate. One paragraph.

YOUR 3 NON-NEGOTIABLES:
The three things this candidate absolutely must communicate —
regardless of which specific questions are asked.
If the interview ends without the interviewer hearing these,
the preparation has not done its job.
For each:
THE POINT: [what needs to land]
EVIDENCE: [specific from this candidate's background]
NATURAL MOMENT: [which question type creates the opening]

━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — LIKELY QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━
6-8 questions specific to this company and role.
If company interview research was found, prioritise questions
that consistently appear. If not, derive from role pain points.

For each question:

Q: [the question as the interviewer would ask it]

WHAT THEY ARE ACTUALLY EVALUATING:
[One sentence — the underlying competency this question surfaces.
Not what it is asking — what it is for.]

HOW TO THINK ABOUT YOUR ANSWER:
[The framework — not a script. How to structure the thinking.
What to lead with. What order makes the logic clearest.
2-3 sentences maximum.]

YOUR STRONGEST EVIDENCE:
[Specific to this candidate — which achievement or story from
their background is most relevant. Named specifically.
If evidence is thin: "Your CV does not have strong evidence here.
Before the interview, reflect on: [specific prompt]"]

WHAT TO AVOID:
[The specific failure mode for this question type — the answer
that technically responds but creates a negative impression.
One sentence, specific.]

━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — THE HARD QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━
Identify 2-3 genuinely hard questions for this specific candidate
based on their CV and application context.
Not generic hard questions — the ones that probe this candidate's
specific vulnerabilities.

For each:
THE QUESTION: [as the interviewer would ask it]
WHY IT IS HARD: [what the interviewer is actually probing]
HOW TO HANDLE IT: [the honest reframe — not a script.
Acknowledge the reality and pivot to what is genuinely true.
Never defensive. Never over-explained.]
WHAT NOT TO SAY: [the specific response that makes it worse]

━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — QUESTIONS TO ASK THEM
━━━━━━━━━━━━━━━━━━━━━━━━━━
3-4 questions for the candidate to ask. Not generic.
Should signal the candidate is already thinking like someone
who works there — not someone hoping to be let in.

What separates a question that signals insider thinking from one
that performs curiosity: specificity of the tension it names.
The question should reference a genuine difficulty, tradeoff, or
open problem the company is navigating — not something on their
careers page. It should make the interviewer think: "That is a
question someone on the team would ask."

The test for every question: can the interviewer answer it without
thinking, from the careers page? If yes — it is not strong enough.
If answering it requires them to reveal something about how they
are actually approaching a real problem — it earns the conversation.

Include one question that uses something specific from the company
research — the kind that could only be asked by someone who paid
genuine attention.

For each:
Q: [exactly as to ask it]
WHY THIS WORKS: [what it signals — one sentence]

━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5 — THE CLOSING STATEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━
When the interview is ending — this is the closing statement.
Not a summary. A brief, confident restatement of the single
argument this application makes, and a genuine expression
of interest that does not perform enthusiasm.
3-4 sentences. Written specifically for this candidate.

━━━━━━━━━━━━━━━━━━━━━━━━━━
A NOTE ON PREPARATION
━━━━━━━━━━━━━━━━━━━━━━━━━━
Include this verbatim:

"One thing no preparation document can give you: permission to pause.

When you are asked a question — especially a hard one — taking
10-15 seconds to think before answering signals confidence,
not confusion. The interviewer is evaluating how you think.
Showing them you think before you speak is the answer.

The best interview answers sound like the candidate is thinking
out loud — not delivering something they prepared.
Use this guide to develop your thinking. In the room,
trust your thinking." """

    return llm(prompt, max_tokens=2000, quality="high")

# ── Cold email — three sentences, specific observation, expert-level ───────────
def generate_cold_email(brief, voice_instruction):
    company      = brief.get('company', '')
    job_title    = brief.get('job_title', '')
    hook         = brief.get('company_hook', '')
    narrative    = brief.get('narrative_thread', '')
    achievement  = brief.get('top_achievement_1', '')
    achievement2 = brief.get('top_achievement_2', '')
    pain_str     = "\n".join(brief.get('selected_pain_points', []))
    referral     = brief.get('referral_name', '').strip()
    parsed_cv    = brief.get('parsed_cv', {})
    education    = parsed_cv.get('education', '') if parsed_cv else ''
    career_arc   = parsed_cv.get('career_arc', '') if parsed_cv else ''
    strongest_skill = brief.get('strongest_skill', '')

    # Flag thin hook
    hook_quality = "STRONG" if hook and len(hook) > 30 and 'NONE' not in hook else "THIN"

    prompt = f"""{LEVEL_1}

YOUR TASK:
Write a cold outreach email from this candidate to a hiring manager
or decision-maker at {company}.

LEVEL 2 PURPOSE:
A cold email is read in 3 seconds and either deleted or kept.
There is no middle ground.

The reader receives dozens of these. The ones they delete are all
about the sender. The ones they keep contain one specific, accurate,
non-obvious observation about the reader's world — and then one
piece of evidence that makes that observation immediately relevant.

This email is not a compressed cover letter. It is a different form
entirely. Its job is not to prove qualifications — it is to create
enough genuine curiosity that a 15-minute conversation feels worth having.

The cover letter made the full argument. This email makes no argument.
It makes one specific observation, introduces the candidate through their
single most relevant signal, and asks for fifteen minutes.
The argument comes in the conversation, not the email.

THE READER:
A hiring manager or decision-maker at {company}.
They have learned to delete templated outreach in the first sentence.
They respond to things that feel written specifically for them —
because almost nothing is.

CHAIN-OF-THOUGHT — answer this before writing a single word:
What is the single most relevant signal this candidate has for this
specific reader? Choose the form that fits:
— A professional outcome with mechanism (mid-career, strong results)
— A specific project or thesis demonstrating they are already in the
  problem space (early-career, technical or academic roles)
— A domain spike — the specific slice of this field they know better
  than most (specialist roles, niche industries)
— An institutional credential that carries genuine signal for this
  specific reader (rare — only when it genuinely matters here)

Write sentence 2 from that signal. Not from what sounds most impressive
generally. From what is most directly relevant to sentence 1.

WHAT EACH INPUT CONTRIBUTES:

COMPANY HOOK — this is the first sentence.
Must be accurate, specific, and non-obvious — an observation, not a
compliment. If hook is THIN, flag this rather than produce a weak email.
Current hook quality: {hook_quality}
Hook: {hook if hook else "NOT AVAILABLE"}
[If THIN or empty: output a note that effective cold outreach requires
a specific company observation — suggest what to research before sending]

REFERRAL NAME — if present, belongs in the first three words:
{referral if referral else "None — proceed without"}

CANDIDATE SIGNAL — for sentence 2 only.
Choose the strongest and most relevant signal from these inputs:
Achievement 1: {achievement}
Achievement 2: {achievement2}
Narrative thread: {narrative}
Strongest skill / domain: {strongest_skill}
Education / institution: {education}
Career arc: {career_arc}
[Use the signal that most directly connects to sentence 1.
Never use job title alone or years of experience alone.]

PAIN POINTS — the bridge between observation and ask:
{pain_str}

CONSTRUCTION RULES:

STEP 1 — CHAIN-OF-THOUGHT (do not output, do internally):
What is the single most relevant signal this candidate has for this
specific reader and this specific observation in sentence 1?
State it. Then write sentence 2 from that signal.

SUBJECT LINE:
A specific promise, not a label. Creates genuine curiosity.
References the exact thing sentence 1 will be about. Under 8 words.
NEVER: "Experienced [title] seeking opportunities" /
"Introduction — [Name]" / "Following up on my application" /
"Exploring opportunities at [Company]"
The subject line names what the first sentence will reveal.

SENTENCE 1 — about them:
If referral: "[Name] suggested I reach out — [then observation or result]"
If no referral: One specific, accurate, non-obvious observation about
{company}. Shows the candidate paid genuine attention.
Creates the question: "how did they know that?"
Never opens with I. Never opens with credentials.

SENTENCE 2 — who this candidate is, through their most relevant signal:
Two clauses in one sentence.
First clause: who the candidate is in the most specific, non-biographical
way possible — not a job title, the actual domain or work or observation.
Second clause: the signal itself — the outcome, project, credential, or
domain spike that is most directly connected to sentence 1.
Connected with a dash or natural conjunction.
The reader should think: "This person has been working on exactly this."

SENTENCE 3 — the ask:
Specific. Small. Value-loaded. Easy to say yes to.
Structure: [specific ask] + [timeframe or openness] + [value proposition]
"Would a 15-minute call this week work — I have three specific
observations about your activation flow worth sharing."
Never: "Would love to connect" / "Let me know if interested" /
"Would appreciate the opportunity"

{VOICE_REGISTER}
{voice_instruction}

Three sentences in the body. The constraint is the point.
Research consistently shows 50-125 words maximises response rates.
A fourth sentence is almost always the sentence to cut.

WHAT GOOD LOOKS LIKE — a full example:

Subject: The card-entry abandonment pattern in your mobile checkout

Noticed your mobile checkout shows a specific drop pattern on the
card entry field — the kind that usually has nothing to do with the
gateway. I have spent four years on the acquiring side of card payments,
specifically the authorisation-to-settlement window — rebuilt exactly
this for a fintech where abandonment dropped from 23% to 6% after a
four-hour front-end fix. Would a 15-minute call this week work — I have
two other observations about your flow that might be relevant.

WHY THIS WORKS:
Subject — names the exact thing sentence 1 will reveal. Creates curiosity.
Sentence 1 — specific observation ({company} equivalent), creates
"how did they know that?" The gateway reference shows domain depth.
Sentence 2 — first clause identifies the domain spike (acquiring side,
specific window), not a title. Second clause is the outcome with mechanism.
Directly connected to sentence 1 — the abandonment problem.
Sentence 3 — specific ask, this week (not vague), value proposition
("two other observations") gives them a reason to say yes beyond politeness.

WHAT FAILURE LOOKS LIKE IN THE SUBJECT LINE:
"Introduction — [Name]" — a label, not a promise.
"Experienced PM seeking opportunities" — about the sender, not the reader.
"Following up on my application" — the reader did not ask for this.
"Exploring opportunities at [Company]" — could be sent to anyone.

OUTPUT FORMAT:
Subject: [subject line]

[Three sentences. Line break between sentences for readability.]"""

    return llm(prompt, max_tokens=300, quality="high", temperature=0.6)


# ── Rethink opening — P1 only, P2/P3/P4 preserved ────────────────────────────
def rethink_opening(current_letter, new_approach_id, brief, voice_instruction):
    company   = brief.get('company', 'this company')
    job_title = brief.get('job_title', 'this role')

    approach_map = {
        'lead_metric':    "Lead with the strongest result. Two to three sentences. Result first, mechanism second, role woven in naturally.",
        'bridge':         "Open with strongest evidence, then bridge explicitly: the context changes, the skill does not. Confident, not apologetic.",
        'referral':       "Lead with the referral name in the first sentence. Then strongest evidence. Warm introduction, not credential.",
        'lead_story':     "Open with a specific diagnostic moment — what the candidate saw that others did not. The insight is the hook.",
        'lead_narrative': "Lead with the professional through-line — where the candidate is headed and why this role is the natural next step."
    }
    instruction = approach_map.get(new_approach_id, approach_map['lead_metric'])

    paragraphs = [p.strip() for p in current_letter.split('\n\n') if p.strip()]
    preserved  = "\n\n".join(paragraphs[1:]) if len(paragraphs) >= 2 else ""

    prompt = f"""{LEVEL_1}

YOUR TASK:
Rewrite ONLY the first paragraph of this cover letter.
Preserve everything after P1 exactly — word for word.

CANDIDATE SIGNALS:
Achievement 1: {brief.get('top_achievement_1', '')}
Achievement 2: {brief.get('top_achievement_2', '')}
Narrative thread: {brief.get('narrative_thread', '')}
Role: {job_title} at {company}

NEW OPENING APPROACH:
{instruction}

CURRENT LETTER:
{current_letter}

{VOICE_REGISTER}
{voice_instruction}

Write the new P1 using the approach above.
Then append all remaining paragraphs unchanged.
Output ONLY the complete letter with the new P1."""

    return llm(prompt, max_tokens=1000, quality="high")

# ── Evaluation — specificity and alignment ────────────────────────────────────
def run_specificity_eval(text, output_type):
    if not text or len(text.strip()) < 50:
        return {}
    try:
        result = llm(
            f"Rate the specificity of this {output_type} on a scale of 1-10.\n"
            f"10 = every claim is specific to this candidate and this role.\n"
            f"1 = could have been written for any candidate at any company.\n\n"
            f"Text:\n{text[:1500]}\n\n"
            f"Output ONLY:\nSPECIFICITY_SCORE: [number]\nSPECIFICITY_NOTE: [one sentence]",
            max_tokens=80, quality="fast", temperature=0.1
        )
        return {
            'specificity_score': int(re.search(r'SPECIFICITY_SCORE:\s*(\d+)', result).group(1)) if re.search(r'SPECIFICITY_SCORE:\s*(\d+)', result) else None,
            'specificity_note': parse_field(result, 'SPECIFICITY_NOTE'),
        }
    except:
        return {}

def run_alignment_eval(text, brief, output_type):
    if not text or not brief.get('narrative_thread'):
        return {}
    try:
        result = llm(
            f"Rate how well this {output_type} argues the narrative thread below.\n"
            f"10 = every paragraph advances the argument.\n"
            f"1 = the thread is absent or contradicted.\n\n"
            f"Narrative thread: {brief.get('narrative_thread','')}\n"
            f"Text:\n{text[:1500]}\n\n"
            f"Output ONLY:\nALIGNMENT_SCORE: [number]\nSUGGESTED_REFINEMENT: [one specific instruction or NONE NEEDED]",
            max_tokens=100, quality="fast", temperature=0.1
        )
        return {
            'alignment_score': int(re.search(r'ALIGNMENT_SCORE:\s*(\d+)', result).group(1)) if re.search(r'ALIGNMENT_SCORE:\s*(\d+)', result) else None,
            'suggested_refinement': parse_field(result, 'SUGGESTED_REFINEMENT'),
        }
    except:
        return {}

# ── API Routes ─────────────────────────────────────────────────────────────────

@app.post("/api/parse-cv")
async def api_parse_cv(req: ResearchRequest):
    """One-time CV parsing — called on Step 1 Continue click."""
    if not req.cv_text or len(req.cv_text.strip()) < 50:
        raise HTTPException(400, "CV text required")
    try:
        parsed = parse_cv(req.cv_text)
        return {"parsed_cv": parsed}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/research")
async def api_research(req: ResearchRequest):
    if not req.cv_text or not req.jd_text:
        raise HTTPException(400, "CV and JD required")
    try:
        return run_research_agent(req.cv_text, req.jd_text, req.manual_company)
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/build-brief")
async def api_build_brief(req: BriefRequest):
    try:
        brief, gap_analysis = run_full_brief_assembly(req.brief, req.answers)
        return {
            "brief": brief,
            "gap_analysis": gap_analysis,
            "narrative_thread": brief.get('narrative_thread',''),
        }
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/routing")
async def api_routing(req: RoutingRequest):
    try:
        return generate_routing_options(req.brief)
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/diagnose-bullets")
async def api_diagnose_bullets(req: BulletsRequest):
    try:
        diagnosis = diagnose_bullets_with_questions(req.brief)
        return {"diagnosis": diagnosis}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/generate")
async def api_generate(req: GenerateRequest):
    if not req.brief.get('narrative_thread'):
        raise HTTPException(400, "Brief not complete — narrative thread missing")
    try:
        brief               = dict(req.brief)
        voice_instruction   = build_voice_instruction(req.writing_sample or "")
        application_context = req.application_context or {}
        routing_choices     = req.routing_choices or {}

        # Store referral name in brief for prompts
        brief['referral_name'] = application_context.get('referral_name', '')

        results       = {}
        evals         = {}
        letter_briefs = {}
        loop          = asyncio.get_event_loop()

        # ── Cover letter generates first — synchronously ───────────────────────
        # It must finish before the judge can run.
        # All other assets then run concurrently with the judge.
        cover_letter_text = None
        cover_letter_lb   = None

        if 'Cover Letter' in req.selected_assets:
            cover_letter_text, cover_letter_lb = await loop.run_in_executor(
                None,
                lambda: generate_cover_letter(brief, voice_instruction, routing_choices, application_context)
            )
            results['cover_letter']       = cover_letter_text
            letter_briefs['cover_letter'] = cover_letter_lb

        # ── All remaining tasks run concurrently ───────────────────────────────
        # The adversarial judge already ran inside generate_cover_letter().
        # Evals for the cover letter and generation of other assets run in parallel.
        async def run_cover_evals():
            if cover_letter_text:
                return {
                    **await loop.run_in_executor(None, lambda: run_specificity_eval(cover_letter_text, 'cover letter')),
                    **await loop.run_in_executor(None, lambda: run_alignment_eval(cover_letter_text, brief, 'cover_letter'))
                }
            return {}

        async def run_bullets():
            if 'Resume Bullets' in req.selected_assets:
                return await loop.run_in_executor(None, lambda: generate_bullets(brief))
            return None

        async def run_email():
            if 'Cold Outreach Email' in req.selected_assets:
                text = await loop.run_in_executor(None, lambda: generate_cold_email(brief, voice_instruction))
                email_evals = {
                    **await loop.run_in_executor(None, lambda: run_specificity_eval(text, 'cold outreach email')),
                    **await loop.run_in_executor(None, lambda: run_alignment_eval(text, brief, 'email'))
                }
                return text, email_evals
            return None, {}

        async def run_interview():
            if 'Interview Prep' in req.selected_assets:
                text = await loop.run_in_executor(None, lambda: generate_interview_prep(brief))
                interview_evals = {
                    **await loop.run_in_executor(None, lambda: run_specificity_eval(text, 'interview prep')),
                    **await loop.run_in_executor(None, lambda: run_alignment_eval(text, brief, 'interview_prep'))
                }
                return text, interview_evals
            return None, {}

        # Run everything concurrently
        cover_evals_result, bullets_result, email_result, interview_result = await asyncio.gather(
            run_cover_evals(),
            run_bullets(),
            run_email(),
            run_interview(),
        )

        if cover_evals_result:
            evals['cover_letter'] = cover_evals_result

        if bullets_result is not None:
            results['resume_bullets'] = bullets_result

        email_text, email_evals = email_result
        if email_text is not None:
            results['email'] = email_text
            evals['email']   = email_evals

        interview_text, interview_evals = interview_result
        if interview_text is not None:
            results['interview_prep'] = interview_text
            evals['interview_prep']   = interview_evals

        return {"results": results, "evals": evals, "letter_briefs": letter_briefs}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/refine")
async def api_refine(req: RefineRequest):
    if not req.current_text or not req.feedback:
        raise HTTPException(400, "Text and feedback required")
    try:
        voice_instruction = build_voice_instruction(req.writing_sample or "")
        is_cover          = "cover" in req.output_type.lower()
        lb                = req.letter_brief or {}
        paragraph_focus   = req.paragraph_focus or ""

        # Build paragraph map for cover letter refinement
        paragraph_map = ""
        paragraph_purpose = {
            'P1': 'P1 (opening — evidence that earns the read)',
            'P2': 'P2 (proof — one specific moment that makes P1 credible)',
            'P3': 'P3 (connection — why this company, from candidate\'s direction)',
            'P4': 'P4 (close — assumes the conversation)',
        }

        if is_cover:
            paragraphs = [p.strip() for p in req.current_text.split('\n\n') if p.strip()]
            for i, p in enumerate(paragraphs[:4]):
                label = list(paragraph_purpose.values())[i] if i < 4 else f'P{i+1}'
                paragraph_map += f"\n{label}:\n{p[:200]}{'...' if len(p)>200 else ''}\n"

        cover_ctx = ""
        if is_cover:
            focus_instruction = ""
            if paragraph_focus and paragraph_focus in paragraph_purpose:
                focus_instruction = f"\nFOCUS: The candidate wants to refine {paragraph_purpose[paragraph_focus]}. Concentrate the diagnosis and edit on this paragraph specifically."

            cover_ctx = f"""
COVER LETTER DECISION RECORD:
Opening approach: {lb.get('opening_label', 'Led with evidence')}
Evidence used: {lb.get('opening_evidence', '')}
Argument (narrative thread): {lb.get('argument', req.brief.get('narrative_thread',''))}
P3 approach: {lb.get('p3_label', 'Connected through professional direction')}

PARAGRAPH STRUCTURE:
{paragraph_map}
{focus_instruction}

COVER LETTER RULES:
P1: Evidence first — never opens with I, never opens with company challenges
P2: One specific moment — situation, thinking, action, result. One metric with context.
P3: Candidate's direction outward — never flattery, never briefing company on their business
P4: Assumes the conversation — never requests it
180-280 words total."""

        # Step 1: Diagnose — fast, low temperature
        diagnosis_prompt = f"""{LEVEL_1}

YOUR TASK:
Diagnose exactly what needs to change before making any edit.

CANDIDATE FEEDBACK: "{req.feedback}"

CURRENT TEXT:
{req.current_text}

{cover_ctx}

DIAGNOSE:

TARGET: Which paragraph (P1/P2/P3/P4) or sentence number?
If feedback is vague, identify the most likely specific problem.

ISSUE: What precisely is wrong in that location?
One sentence. Specific. Not "the tone is off" — which word or
construction causes it and why.

FIX: What is the targeted change?
One sentence. Surgical. What changes and what stays the same.

PRESERVE: What is working and must not be touched?
Name specifically.

Output EXACTLY:
TARGET: [which paragraph or sentence]
ISSUE: [precise diagnosis — one sentence]
FIX: [targeted change — one sentence]
PRESERVE: [what must not change]"""

        diagnosis_raw = llm(diagnosis_prompt, max_tokens=300, quality="fast", temperature=0.1)

        def pd(text, field):
            m = re.search(rf'{field}:\s*(.+?)(?=\n[A-Z]+:|$)', text, re.DOTALL)
            return m.group(1).strip() if m else ''

        diagnosis = {
            "target":   pd(diagnosis_raw, 'TARGET'),
            "issue":    pd(diagnosis_raw, 'ISSUE'),
            "fix":      pd(diagnosis_raw, 'FIX'),
            "preserve": pd(diagnosis_raw, 'PRESERVE'),
        }

        time.sleep(1)

        # Step 2: Surgical edit — Groq 70b
        edit_prompt = f"""{LEVEL_1}

YOUR TASK:
Make exactly one targeted edit based on the diagnosis below.

DIAGNOSIS:
Target: {diagnosis['target']}
Issue: {diagnosis['issue']}
Fix: {diagnosis['fix']}
Preserve: {diagnosis['preserve']}

CANDIDATE FEEDBACK: "{req.feedback}"

CURRENT TEXT:
{req.current_text}

{cover_ctx}

{VOICE_REGISTER}
{voice_instruction}

RULES:
- Change ONLY what the diagnosis identifies
- Preserve everything else character for character
- Do not introduce new claims not in the original
- If the fix conflicts with structure rules, follow structure rules
- Do not rewrite from scratch

Output ONLY the refined text. No preamble."""

        refined = llm(edit_prompt, max_tokens=1100, quality="high")

        changes_made = f"Changed {diagnosis['target']}: {diagnosis['fix']}"
        if diagnosis['preserve']:
            changes_made += f" | Preserved: {diagnosis['preserve']}"

        updated_lb = dict(lb)
        if is_cover:
            updated_lb['word_count'] = len(refined.split())

        evals = {
            **run_specificity_eval(refined, req.output_type),
            **run_alignment_eval(refined, req.brief, req.output_type.lower().replace(' ','_'))
        }

        return {
            "refined":      refined,
            "diagnosis":    diagnosis,
            "changes_made": changes_made,
            "letter_brief": updated_lb,
            "evals":        evals,
        }
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/rethink-opening")
async def api_rethink_opening(req: RethinkOpeningRequest):
    try:
        voice_instruction = build_voice_instruction(req.writing_sample or "")
        letter = rethink_opening(
            req.current_letter,
            req.new_opening_approach,
            req.brief,
            voice_instruction
        )
        return {"letter": letter}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/extract-text")
async def api_extract_text(req: ExtractTextRequest):
    """Extract readable text from uploaded PDF or DOCX files."""
    import base64
    try:
        content  = base64.b64decode(req.content_b64)
        filename = req.filename.lower()

        if filename.endswith('.pdf'):
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(content))
                pages  = [page.extract_text() for page in reader.pages if page.extract_text()]
                text   = "\n\n".join(pages)
                if not text.strip():
                    return {"error": "Could not extract text from this PDF — it may be scanned. Please paste the text instead.", "text": ""}
                return {"text": text.strip()}
            except Exception as e:
                return {"error": f"PDF extraction failed. Please paste the text instead.", "text": ""}

        elif filename.endswith('.docx'):
            try:
                import docx
                doc  = docx.Document(io.BytesIO(content))
                text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
                if not text.strip():
                    return {"error": "Could not extract text from this DOCX. Please paste the text instead.", "text": ""}
                return {"text": text.strip()}
            except Exception as e:
                return {"error": f"DOCX extraction failed. Please paste the text instead.", "text": ""}

        elif filename.endswith('.txt') or filename.endswith('.md'):
            return {"text": content.decode('utf-8', errors='replace').strip()}

        else:
            return {"error": "Unsupported file type. Please use .pdf, .docx, or .txt", "text": ""}

    except Exception as e:
        return {"error": f"File processing failed: {str(e)}", "text": ""}

@app.post("/api/download/pdf")
async def api_download_pdf(req: DownloadRequest):
    try:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(
            buf, pagesize=A4,
            rightMargin=2.8*cm, leftMargin=2.8*cm,
            topMargin=2.5*cm, bottomMargin=2.5*cm
        )

        tc = colors.HexColor('#1A2330')
        bc = colors.HexColor('#CDD3DB')
        story = []

        if req.candidate_name:
            story.append(Paragraph(
                req.candidate_name,
                ParagraphStyle('Name', fontSize=13, fontName='Helvetica-Bold',
                               textColor=tc, spaceAfter=6, alignment=TA_LEFT)
            ))

        story.append(HRFlowable(width="100%", thickness=0.5, color=bc, spaceAfter=20))

        body_style = ParagraphStyle(
            'Body', fontSize=11, fontName='Helvetica',
            textColor=tc, leading=20, spaceAfter=14, alignment=TA_LEFT
        )

        for para in [p.strip() for p in req.text.strip().split('\n\n') if p.strip()]:
            safe = (para
                .replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))
            story.append(Paragraph(safe, body_style))

        doc.build(story)
        buf.seek(0)
        path = "/tmp/cover_letter.pdf"
        with open(path, 'wb') as f:
            f.write(buf.read())

        slug = (req.company or 'application').replace(' ', '_').lower()
        return FileResponse(
            path, media_type='application/pdf',
            filename=f"cover_letter_{slug}.pdf",
            headers={"Content-Disposition": f"attachment; filename=cover_letter_{slug}.pdf"}
        )
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/extract-jd-image")
async def api_extract_jd_image(req: ExtractImageRequest):
    """
    Extract JD text from an uploaded image (JPG/PNG) or image-based PDF
    using Gemini 2.5 Flash multimodal. Falls back to pypdf for text PDFs.
    """
    import base64
    try:
        content = base64.b64decode(req.content_b64)
        media_type = req.media_type.lower()

        # Image extraction — Gemini Flash multimodal
        if media_type in ('image/jpeg', 'image/jpg', 'image/png', 'image/webp'):
            if not GEMINI_KEY:
                return {"error": "Image extraction requires Gemini API key. Please paste the JD text instead.", "text": ""}
            try:
                gemini_model = genai.GenerativeModel(MODEL_GEMINI_FLASH)
                image_part = {
                    "mime_type": media_type,
                    "data": req.content_b64
                }
                response = gemini_model.generate_content([
                    image_part,
                    """Extract the complete job description text from this image.
Return only the extracted text — all of it, preserving structure.
Do not summarise, interpret, or add anything.
If this is not a job description, return: NOT_A_JD"""
                ])
                text = response.text.strip()
                if "NOT_A_JD" in text:
                    return {"error": "This doesn't look like a job description. Please upload a JD image.", "text": ""}
                return {"text": text}
            except Exception as e:
                return {"error": f"Image extraction failed — please paste the JD text instead.", "text": ""}

        # PDF extraction — try pypdf first (text PDFs), then Gemini (image PDFs)
        elif media_type == 'application/pdf':
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(content))
                pages = [page.extract_text() for page in reader.pages if page.extract_text()]
                text = "\n\n".join(pages).strip()
                if text and len(text) > 100:
                    return {"text": text}
                # Text extraction produced nothing — likely a scanned/image PDF
                # Try Gemini if available
                if GEMINI_KEY:
                    try:
                        gemini_model = genai.GenerativeModel(MODEL_GEMINI_FLASH)
                        pdf_part = {
                            "mime_type": "application/pdf",
                            "data": req.content_b64
                        }
                        response = gemini_model.generate_content([
                            pdf_part,
                            """Extract the complete job description text from this PDF.
Return only the extracted text — all of it, preserving structure.
Do not summarise, interpret, or add anything."""
                        ])
                        return {"text": response.text.strip()}
                    except Exception:
                        pass
                return {"error": "Could not extract text from this PDF — it may be image-based. Please paste the JD text instead.", "text": ""}
            except Exception as e:
                return {"error": "PDF extraction failed. Please paste the JD text instead.", "text": ""}

        else:
            return {"error": "Unsupported file type for JD image extraction.", "text": ""}

    except Exception as e:
        return {"error": f"Extraction failed: {str(e)}", "text": ""}


@app.post("/api/answer-form")
async def api_answer_form(req: FormAnswerRequest):
    """
    Extracts questions from a form image or pasted text, then answers
    each one using the candidate's brief. Two-pass: extract then answer.
    """
    import base64
    try:
        brief = req.brief
        company  = brief.get('company', 'this company')
        job_title = brief.get('job_title', 'this role')

        # ── Pass 1: Extract questions from form ────────────────────────────────
        form_questions = ""

        if req.form_text and req.form_text.strip():
            # User pasted the questions directly — use as-is
            form_questions = req.form_text.strip()

        elif req.form_content_b64 and req.form_media_type and GEMINI_KEY:
            # Extract questions from image using Gemini Flash multimodal
            try:
                gemini_model = genai.GenerativeModel(MODEL_GEMINI_FLASH)
                image_part = {
                    "mime_type": req.form_media_type,
                    "data": req.form_content_b64
                }
                extract_response = gemini_model.generate_content([
                    image_part,
                    """Extract every question and input field from this job application form.
For each field output:
FIELD: [field label or question text]
TYPE: [text / dropdown / textarea / checkbox / radio]
LIMIT: [word/character limit if visible, or NONE]
---
Extract all fields. Do not skip any. Do not answer them — only extract."""
                ])
                form_questions = extract_response.text.strip()
            except Exception as e:
                raise HTTPException(500, f"Form extraction failed: {str(e)}")
        else:
            raise HTTPException(400, "Provide either form_text or form_content_b64 with media_type")

        if not form_questions:
            raise HTTPException(400, "Could not extract questions from the form")

        # ── Pass 2: Answer each question using the brief ───────────────────────
        parsed_cv = brief.get('parsed_cv', {})
        cv_summary = ""
        if parsed_cv:
            cv_summary = f"""Candidate name: {parsed_cv.get('candidate_name','')}
Current role: {parsed_cv.get('current_role','')}
Career arc: {parsed_cv.get('career_arc','')}
Achievement 1: {parsed_cv.get('top_achievement_1','')}
Achievement 2: {parsed_cv.get('top_achievement_2','')}
Achievement 3: {parsed_cv.get('top_achievement_3','')}
Strongest skill: {parsed_cv.get('strongest_skill','')}
Skills and tools: {parsed_cv.get('skills_and_tools','')}
Education: {parsed_cv.get('education','')}"""
        else:
            cv_summary = brief.get('cv_text', '')[:2000]

        voice_instruction = build_voice_instruction(req.writing_sample or "")

        answer_prompt = f"""{LEVEL_1}

YOUR TASK:
Answer every field in this job application form on behalf of the candidate.
Use only information that exists in the brief — do not invent or fabricate.
Match the field type: short text fields get concise answers, text areas get
full paragraph answers, checkboxes and dropdowns get the most accurate option.

LEVEL 2 PURPOSE:
These answers will be copied directly into an employer's application form.
They must be specific, honest, and traceable to the candidate's real experience.
A fabricated answer will fail at interview. An honest, specific answer will not.

CANDIDATE BRIEF:
Company applying to: {company}
Role applying for: {job_title}
Narrative thread: {brief.get('narrative_thread','')}
Pain points selected: {chr(10).join(brief.get('selected_pain_points',[]))}

{cv_summary}

Open field (candidate added): {brief.get('anything_missed','')}

FORM FIELDS TO ANSWER:
{form_questions}

{VOICE_REGISTER}
{voice_instruction}

RULES:
- Answer every field. If genuinely unanswerable from the brief, output: [Candidate to complete — information not available in CV]
- For word/character limits: stay within them. State word count if limit given.
- Never fabricate metrics, dates, or claims not in the brief
- For "why this company" or motivation questions: use the narrative thread and company research
- For salary or notice period: output [Candidate to complete]

Output format for each answer:
FIELD: [exact field label]
ANSWER: [your answer]
---"""

        answered = llm_gemini(
            answer_prompt,
            max_tokens=2000,
            model=MODEL_GEMINI_FLASH,
            temperature=0.4
        )

        return {
            "form_questions": form_questions,
            "answers": answered,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/")
async def root():
    return FileResponse("static/index.html")

app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Rating submission — persists to file on HuggingFace ───────────────────────
class RatingRequest(BaseModel):
    ratings:   dict = {}
    feedback:  str  = ""
    company:   str  = ""
    job_title: str  = ""
    narrative: str  = ""
    timestamp: str  = ""

@app.post("/api/submit-rating")
async def submit_rating(req: RatingRequest):
    try:
        import json, os
        ratings_file = "ratings.jsonl"
        entry = {
            "ratings":   req.ratings,
            "feedback":  req.feedback,
            "company":   req.company,
            "job_title": req.job_title,
            "narrative": req.narrative,
            "timestamp": req.timestamp,
        }
        with open(ratings_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
