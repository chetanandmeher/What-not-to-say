# -----------------------------------------------
# AI Parliament — Game Engine (The Brain)
# -----------------------------------------------
# Orchestrates: Question → Answers → Voting → Tallying → Elimination → Evolution
# -----------------------------------------------

import copy
from collections import Counter
from backend.personalities import CONTESTANTS, remove_contestant, add_contestant, reset_scores
from backend.groq_client import (
    ask_all_contestants,
    ask_all_to_vote,
    generate_situation,
)
import asyncio


class AIParliamentGame:
    """
    The core game engine for AI Parliament.
    Manages rounds, scoring, elimination, and evolution.
    """

    def __init__(self):
        self.contestants = copy.deepcopy(CONTESTANTS)
        self.round_number = 0
        self.rounds_since_elimination = 0
        self.elimination_threshold = 6          # eliminate after every N rounds
        self.history = []                        # list of round results
        self.eliminated = []                     # list of eliminated contestants
        self.game_over = False
        self.pending_round_data = None           # stores generated answers waiting for voting

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
        }

    async def generate_answers_phase(self, custom_situation: str = None) -> dict:
        """
        Phase 1: Generate or accept a situation, and get all contestants to answer simultaneously.
        """
        if self.game_over:
            return {"error": "Game is over. Start a new game."}

        active = self.get_active_contestants()
        if len(active) < 2:
            self.game_over = True
            return {"error": "Not enough contestants to play a round."}

        # --- Step 1: Situation ---
        if custom_situation and custom_situation.strip():
            situation = custom_situation.strip()
        else:
            previous_situations = [r["situation"] for r in self.history]
            situation = await generate_situation(active, previous_situations)

        # --- Step 2: All contestants answer ---
        answers = await ask_all_contestants(active, situation)

        self.pending_round_data = {
            "situation": situation,
            "answers": answers,
            "active": active
        }

        return {
            "round": self.round_number + 1,
            "situation": situation,
            "answers": answers
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

        # --- Step 3: Cross-voting ---
        votes = await ask_all_to_vote(active, situation, answers)

        # --- Step 4: Tally ---
        vote_counts = Counter()
        for v in votes:
            vote_counts[v["voted_for"]] += 1

        # Find round winner and loser
        round_winner = vote_counts.most_common(1)[0][0] if vote_counts else None

        all_names = [a["name"] for a in active]
        for name in all_names:
            if name not in vote_counts:
                vote_counts[name] = 0

        round_loser = vote_counts.most_common()[-1][0] if vote_counts else None

        # Update scores on our local contestants list
        for c in self.contestants:
            if c["name"] == round_winner:
                c["wins"] += 1
            if c["name"] == round_loser:
                c["losses"] += 1

        # Build round result
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

        # Check if elimination is due
        should_eliminate = (
            self.rounds_since_elimination >= self.elimination_threshold
            and len(active) > 2
        )

        round_result["elimination_due"] = should_eliminate

        return round_result

    async def eliminate_lowest(self) -> dict:
        """
        Eliminate the contestant with the lowest cumulative wins.
        Ties are broken by most losses.
        Then trigger the evolution phase.
        """
        active = self.get_active_contestants()
        if len(active) <= 1:
            return {"error": "Cannot eliminate — only 1 contestant remains (Game Over)."}

        # Sort: lowest wins first, then most losses
        sorted_active = sorted(active, key=lambda c: (c["wins"], -c["losses"]))
        victim = sorted_active[0]

        # Mark as eliminated
        for c in self.contestants:
            if c["name"] == victim["name"]:
                c["alive"] = False

        self.eliminated.append({
            "name": victim["name"],
            "model": victim["model"],
            "round_eliminated": self.round_number,
            "final_wins": victim["wins"],
            "final_losses": victim["losses"],
        })

        self.rounds_since_elimination = 0

        # --- BATTLE ROYALE MODE: EVOLUTION DISABLED ---
        new_contestant = None

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

        # Pick the top survivor (most wins) to be the "analyst"
        analyst = sorted(survivors, key=lambda c: c["wins"], reverse=True)[0]

        evolution_prompt = f"""A contestant called "{eliminated['name']}" has been eliminated from an AI debate competition.

Their personality was: {eliminated['system_prompt']}

They were eliminated because they consistently received the fewest votes from other AI judges.

Your task: Design a NEW, BETTER contestant personality that would be more persuasive and appealing to AI judges. 
The new personality should be DIFFERENT from the eliminated one — learn from what failed.

Reply with ONLY:
NAME: [a creative 2-3 word name starting with "The"]
PERSONALITY: [a 2-3 sentence personality description]"""

        from backend.groq_client import _call_groq
        raw = await asyncio.to_thread(
            _call_groq, analyst["model"], "You are an AI evolution designer.", evolution_prompt
        )

        # Parse the response
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
            "model": eliminated["model"],      # inherit the same model
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
        for c in self.contestants:
            c["alive"] = True
        self.round_number = 0
        self.rounds_since_elimination = 0
        self.history = []
        self.eliminated = []
        self.game_over = False
