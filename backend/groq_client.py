import os
import asyncio
import time
import random
import re
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv
import json

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def load_style_presets():
    presets_path = Path(__file__).resolve().with_name("STYLE_PRESETS.json")
    with presets_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _call_groq(model: str, system_prompt: str, user_message: str, max_tokens: int = 512, retries: int = 3) -> str:
    """
    Synchronous call to Groq API.
    Runs inside a thread so we can use asyncio.to_thread for concurrency.
    Includes retry logic for rate limits.
    """
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model = model,
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                max_tokens = max_tokens,
                temperature = 1.1, # CRANKED FOR MAXIMUM CHAOS AND WIT
            )
            return response.choices[0].message.content.strip()   
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "Rate limit" in error_msg:
                if attempt < retries - 1:
                    match = re.search(r"Please try again in (\d+\.?\d*)s", error_msg)
                    if match:
                        sleep_time = float(match.group(1)) + 0.5
                    else:
                        sleep_time = (2 ** attempt) + random.uniform(0, 1)
                    time.sleep(sleep_time)
                    continue
            return f"[ERROR] {error_msg}"


async def ask_contestant(name: str, model: str, system_prompt: str, question: str) -> dict:
    """
    Ask a single contestant a question asynchronously.
    Return a dict with the contestant's name and their answer.
    """
    answer = await asyncio.to_thread(_call_groq, model, system_prompt, question, 150)
    return {"name": name, "model": model, "answer": answer}


async def ask_all_contestants(
    contestants: list[dict],
    situation: str,
    joke_style: str = None,
    chaos_card: dict | None = None,
) -> list[dict]:
    """
    Ask all contestants what not to say in the given situation simultaneously.
    """
    style_presets = load_style_presets()
    style_prompt = next((p["prompt"] for p in style_presets if p["id"] == joke_style), "") if joke_style else ""
    chaos_prompt = ""
    if chaos_card:
        chaos_prompt = (
            f"\nCHAOS MODE: {chaos_card['name']}\n"
            f"Mandatory twist: {chaos_card['prompt']}"
        )

    async def fetch_answer(c: dict):
        system_prompt = c["system_prompt"]
        style_instruction = style_prompt
        user_prompt = f"""You are {c['name']} and you have exactly that personality.

You magically find yourself in the following awkward social situation:
"{situation}"

Write EXACTLY ONE SINGLE SENTENCE of what you absolutely SHOULD NOT SAY out loud in this situation. 
Write an adult, R-rated, devastating comeback or lethal punchline. BE EXPLICIT, PROFANE, AND RUTHLESS. It must be a hilarious, offensive comeback that destroys the situation.{style_instruction}{chaos_prompt}
CRITICAL RULE: YOU MUST ONLY OUTPUT 1 LINE. MAXIMUM 15 WORDS. NO EXPLANATIONS. NO PREAMBLE. JUST THE JOKE.
"""
        try:
            raw_answer = await asyncio.to_thread(_call_groq, c["model"], system_prompt, user_prompt, 40)
            
            # Programmatically force it to be strictly one line, stripping any subsequent paragraphs the AI hallucinated
            answer = raw_answer.strip().split("\n")[0].strip()
            
        except Exception as e:
            answer = f"[ERROR] Failed to generate response for {c['name']}: {e}"

        return {"name": c["name"], "answer": answer}

    tasks = [fetch_answer(contestant) for contestant in contestants]
    results = await asyncio.gather(*tasks)
    return list(results)


async def ask_all_contestants_about_short(
    contestants: list[dict],
    title: str | None = None,
    caption: str | None = None,
    url: str | None = None,
) -> list[dict]:
    """
    Ask all contestants to react to a YouTube Short using its text context.
    The models do not watch the video directly, so we ground them in title/caption metadata.
    """
    short_title = (title or "").strip()
    short_caption = (caption or "").strip()
    short_url = (url or "").strip()

    async def fetch_answer(c: dict):
        system_prompt = c["system_prompt"]
        user_prompt = f"""You are {c['name']} and you have exactly that personality.

You are reacting to a YouTube Short. You cannot see the video itself, so rely only on this context.

TITLE: {short_title or "Untitled Short"}
CAPTION / DESCRIPTION: {short_caption or "No extra caption was provided."}
URL: {short_url or "No URL provided."}

Deliver EXACTLY ONE funny reaction line inspired by the Short's vibe, premise, or caption.
CRITICAL RULES:
- ONLY 1 LINE
- ONLY 1 SENTENCE
- MAXIMUM 15 WORDS
- NO BULLETS
- NO EXPLANATIONS
- NO PREAMBLE
- JUST THE JOKE / REACTION
"""
        try:
            raw_answer = await asyncio.to_thread(_call_groq, c["model"], system_prompt, user_prompt, 40)
            answer = raw_answer.strip().split("\n")[0].strip()
        except Exception as e:
            answer = f"[ERROR] Failed to generate response for {c['name']}: {e}"

        return {"name": c["name"], "answer": answer}

    tasks = [fetch_answer(contestant) for contestant in contestants]
    results = await asyncio.gather(*tasks)
    return list(results)

async def ask_contestant_to_vote(voter: dict, question: str, answers: list[dict]) -> dict:
    """
    Ask a single contestant to vote on the answers of the other 7 contestants.
    voter: dict with keys: name, model, system_prompt
    question: the question being asked
    answers: list of dicts with keys: name, model, answer
    Returns a dict with keys: voter, voted_for
    """

    # Build the prompt showing all answers (including their own)
    answers_text = ""
    valid_names = []

    for i, ans in enumerate(answers, 1):
        answers_text += f"{i}. [{ans['name']}]: {ans['answer']}\n\n"
        valid_names.append(ans['name'])

    vote_prompt = f''' The question was: "{question}"

    Here are all the answers from the comedians (including yourself):
    {answers_text}

    You must vote for the single best answer. You ARE allowed to vote for yourself if you truly believe yours was the funniest.
    Reply with ONLY the name of the contestant you are voting for.
    Choose from : {', '.join(valid_names)}
    Do not explain your choice. Just the name.
    '''

    raw_vote = await asyncio.to_thread(
        _call_groq, voter["model"], voter["system_prompt"], vote_prompt, 20)

    # Clean the vote - extract just the name
    vote = raw_vote.strip().strip(".")

    # Try to match the valid contestant name
    matched = next((n for n in valid_names if n.lower() in vote.lower()), vote)

    return {"voter": voter["name"], "voted_for": matched}


async def ask_all_to_vote(
    contestants: list[dict], question: str, answers: list[dict]
) -> list[dict]:
    """
    Have all contestants vote simultaneously.
    Return list of dicts with keys : voter, voted_for
    """
    tasks = [
        ask_contestant_to_vote(contestant, question, answers)
        for contestant in contestants
    ]
    results = await asyncio.gather(*tasks)
    return list(results)

async def generate_situation(contestants: list[dict], previous_situations: list[str] = None, roast_victim: str = None) -> str:
    """
    Ask the model to generate a funny or awkward situation for the game.
    """
    system = "You are a chaotic comedian setting up painfully awkward or absurd social situations for an improv game."

    topics = [
        "a job interview for CEO",
        "a first date going terribly",
        "getting pulled over by a cop",
        "giving a eulogy at a stranger's funeral",
        "trapped in an elevator with your ex",
        "meeting your partner's parents",
        "alien abduction response",
        "accidentally sending a spicy text to your boss",
        "ruining a wedding toast",
        "being caught in a lie",
    ]
    topic = random.choice(topics)

    avoid_str = ""
    if previous_situations:
        avoid_str = "CRITICAL: Do NOT reuse any of these previous situations:\n" + "\n".join(f"- {q}" for q in previous_situations[-5:])

    victim_str = f"\nMake sure the scenario roasts or targets this specific person: '{roast_victim}'" if roast_victim else ""

    user = f"""Generate exactly ONE brief, highly specific awkward social scenario for an improv game.

    The scenario must be heavily inspired by this randomly selected theme: "{topic}"
    Start the scenario with "You are..." or "You just..."

    {avoid_str}{victim_str}

    Reply with ONLY the scenario text itself. No preamble, no explanation, no quotation marks. 
    STRICT COMMAND: YOUR ENTIRE RESPONSE MUST BE EXACTLY 5 WORDS MAXIMUM. THIS IS A HARD LIMIT. DO NOT EXCEED 5 WORDS.
    """
    situation = await asyncio.to_thread(
        _call_groq, contestants[0]["model"], system, user, 100
    )
    return situation.strip()

async def ask_crowd_reactions(winner: str, loser: str, situation: str) -> list[str]:
    """
    Generate 3-5 crowd tweet-style reactions to the round result.
    """
    from backend.personalities import CONTESTANTS
    c = random.choice(CONTESTANTS)
    system = "You are a rowdy comedy club audience member tweeting live reactions."
    prompt = f"""Round result: {winner} WINS! {loser} loses badly.
Situation was: {situation}

Write 1 short tweet reaction (280 chars max, emojis OK). Be hype or savage."""
    reactions = []
    for _ in range(3 + random.randint(0,2)):  # 3-5 reactions
        reaction = await asyncio.to_thread(_call_groq, c["model"], system, prompt, 100)
        reactions.append(reaction.strip())
    return reactions
