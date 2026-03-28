# -----------------------------------------------
# AI Parliament — Game Engine (The Brain)
# -----------------------------------------------
# Orchestrates: Question -> Answers -> Voting -> Tallying -> Elimination -> Evolution
# -----------------------------------------------

import asyncio
import copy
from collections import Counter

from backend.groq_client import (
    ask_all_contestants,
    ask_all_contestants_about_short,
    ask_all_to_vote,
    generate_situation,
)
from backend.personalities import CONTESTANTS


class AIParliamentGame:
    """
    The core game engine for AI Parliament.
    Manages rounds, scoring, elimination, and evolution.
    """

    def __init__(self):
        self.contestants = copy.deepcopy(CONTESTANTS)
        self.round_number = 0
        self.rounds_since_elimination = 0
        self.elimination_threshold = 6
        self.history = []
        self.short_reaction_history = []
        self.eliminated = []
        self.game_over = False
        self.pending_round_data = None

    def get_active_contestants(self) -> list[dict]:
        """Return only alive contestants."""
        return [c for c in self.contestants if c.get("alive", True)]

    def get_standings(self) -> list[dict]:
        """Return contestants sorted by wins descending."""
        active = self.get_active_contestants()
        return sorted(active, key=lambda c: c["wins"], reverse=True)

    def get_full_state(self) -> dict:
        """Return the complete game state for the frontend."""
        return {
            "round_number": self.round_number,
            "rounds_until_elimination": self.elimination_threshold - self.rounds_since_elimination,
            "contestants": [
                {
                    "name": c["name"],
                    "model": c["model"],
                    "wins": c["wins"],
                    "losses": c["losses"],
                    "alive": c.get("alive", True),
                }
                for c in self.contestants
            ],
            "eliminated": self.eliminated,
            "game_over": self.game_over,
            "history": self.history,
            "short_reaction_history": self.short_reaction_history,
        }

    async def generate_answers_phase(
        self,
        custom_situation: str = None,
        joke_style: str = None,
        roast_victim: str = None,
    ) -> dict:
        """
        Phase 1: Generate or accept a situation, and get all contestants to answer simultaneously.
        """
        if self.game_over:
            return {"error": "Game is over. Start a new game."}

        active = self.get_active_contestants()
        if len(active) < 2:
            self.game_over = True
            return {"error": "Not enough contestants to play a round."}

        previous_situations = [r["situation"] for r in self.history]

        if custom_situation and custom_situation.strip():
            situation = custom_situation.strip()
        else:
            situation = await generate_situation(active, previous_situations, roast_victim)

        answers = await ask_all_contestants(active, situation, joke_style)

        self.pending_round_data = {
            "situation": situation,
            "answers": answers,
            "active": active,
        }

        return {
            "round": self.round_number + 1,
            "situation": situation,
            "answers": answers,
        }

    async def execute_voting_phase(self) -> dict:
        """
        Phase 2: Use the pending answers to trigger cross-voting, tally the scores, and build the history.
        """
        if not self.pending_round_data:
            return {"error": "No pending answers to vote on."}

        active = self.pending_round_data["active"]
        situation = self.pending_round_data["situation"]
        answers = self.pending_round_data["answers"]
        self.pending_round_data = None

        self.round_number += 1
        self.rounds_since_elimination += 1

        votes = await ask_all_to_vote(active, situation, answers)

        vote_counts = Counter()
        for vote in votes:
            vote_counts[vote["voted_for"]] += 1

        round_winner = vote_counts.most_common(1)[0][0] if vote_counts else None

        for contestant in active:
            vote_counts.setdefault(contestant["name"], 0)

        round_loser = vote_counts.most_common()[-1][0] if vote_counts else None

        for contestant in self.contestants:
            if contestant["name"] == round_winner:
                contestant["wins"] += 1
            if contestant["name"] == round_loser:
                contestant["losses"] += 1

        round_result = {
            "round": self.round_number,
            "situation": situation,
            "answers": answers,
            "votes": votes,
            "vote_counts": dict(vote_counts),
            "winner": round_winner,
            "loser": round_loser,
        }

        self.history.append(round_result)

        should_eliminate = (
            self.rounds_since_elimination >= self.elimination_threshold
            and len(active) > 2
        )
        round_result["elimination_due"] = should_eliminate

        return round_result

    async def generate_short_reactions(
        self,
        title: str | None = None,
        caption: str | None = None,
        url: str | None = None,
    ) -> dict:
        """
        Generate one-line reactions from active contestants for a YouTube Short.
        """
        if not (title and title.strip()) and not (caption and caption.strip()):
            return {"error": "A Short title or caption is required."}

        active = self.get_active_contestants()
        if not active:
            return {"error": "No active contestants available."}

        short_info = {
            "title": (title or "").strip(),
            "caption": (caption or "").strip(),
            "url": (url or "").strip(),
        }
        answers = await ask_all_contestants_about_short(
            active,
            title=short_info["title"],
            caption=short_info["caption"],
            url=short_info["url"],
        )

        result = {
            "short": short_info,
            "answers": answers,
        }
        self.short_reaction_history.append(result)
        return result

    async def eliminate_lowest(self) -> dict:
        """
        Eliminate the contestant with the lowest cumulative wins.
        Ties are broken by most losses.
        """
        active = self.get_active_contestants()
        if len(active) <= 1:
            return {"error": "Cannot eliminate - only 1 contestant remains (Game Over)."}

        victim = sorted(active, key=lambda c: (c["wins"], -c["losses"]))[0]

        for contestant in self.contestants:
            if contestant["name"] == victim["name"]:
                contestant["alive"] = False

        self.eliminated.append(
            {
                "name": victim["name"],
                "model": victim["model"],
                "round_eliminated": self.round_number,
                "final_wins": victim["wins"],
                "final_losses": victim["losses"],
            }
        )

        self.rounds_since_elimination = 0

        remaining_count = len(self.get_active_contestants())
        if remaining_count <= 1:
            self.game_over = True

        return {
            "eliminated": victim["name"],
            "reason": f"Lowest score: {victim['wins']} wins, {victim['losses']} losses",
            "new_contestant": None,
            "remaining": remaining_count,
            "game_over": self.game_over,
        }

    async def _evolve(self, eliminated: dict, survivors: list[dict]) -> dict | None:
        """
        GAN-like evolution: a survivor analyzes the loser's failure
        and generates a mutated personality to fill the slot.
        """
        if not survivors:
            return None

        analyst = sorted(survivors, key=lambda c: c["wins"], reverse=True)[0]

        evolution_prompt = f"""A contestant called "{eliminated['name']}" has been eliminated from an AI debate competition.

Their personality was: {eliminated['system_prompt']}

They were eliminated because they consistently received the fewest votes from other AI judges.

Your task: Design a NEW, BETTER contestant personality that would be more persuasive and appealing to AI judges.
The new personality should be DIFFERENT from the eliminated one - learn from what failed.

Reply with ONLY:
NAME: [a creative 2-3 word name starting with "The"]
PERSONALITY: [a 2-3 sentence personality description]"""

        from backend.groq_client import _call_groq

        raw = await asyncio.to_thread(
            _call_groq,
            analyst["model"],
            "You are an AI evolution designer.",
            evolution_prompt,
        )

        new_name = "The Evolved"
        new_personality = raw

        for line in raw.split("\n"):
            line = line.strip()
            if line.upper().startswith("NAME:"):
                new_name = line.split(":", 1)[1].strip()
            elif line.upper().startswith("PERSONALITY:"):
                new_personality = line.split(":", 1)[1].strip()

        new_contestant = {
            "name": new_name,
            "model": eliminated["model"],
            "system_prompt": new_personality,
            "wins": 0,
            "losses": 0,
            "alive": True,
            "evolved_from": eliminated["name"],
        }

        self.contestants.append(new_contestant)

        return {
            "name": new_name,
            "evolved_from": eliminated["name"],
            "personality_preview": new_personality[:200],
        }

    def reset(self):
        """Reset the game to initial state."""
        self.contestants = copy.deepcopy(CONTESTANTS)
        for contestant in self.contestants:
            contestant["alive"] = True
        self.round_number = 0
        self.rounds_since_elimination = 0
        self.history = []
        self.short_reaction_history = []
        self.eliminated = []
        self.game_over = False
        self.pending_round_data = None
