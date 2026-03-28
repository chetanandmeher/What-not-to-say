# -----------------------------------------------
# AI Parliament — FastAPI Server
# -----------------------------------------------
# REST API + static file serving for the Control Room frontend
# -----------------------------------------------

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from backend.game import AIParliamentGame
import os

app = FastAPI(title="AI Parliament", version="1.0.0")

# --- Game Instance ---
game = AIParliamentGame()

# --- Request Models ---
class RoundRequest(BaseModel):
    situation: str | None = None
    joke_style: str | None = None
    roast_victim: str | None = None
    chaos_id: str | None = None


class SettingsRequest(BaseModel):
    elimination_threshold: int


class ShortReactionRequest(BaseModel):
    url: str | None = None
    title: str | None = None
    caption: str | None = None

# -----------------------------------------------
# API Routes
# -----------------------------------------------

@app.post("/api/game/start")
async def start_game():
    """Reset and start a new game."""
    game.reset()
    return {"status": "Game started", "state": game.get_full_state()}


@app.post("/api/game/settings")
async def update_settings(req: SettingsRequest):
    """Update active game engine settings."""
    game.elimination_threshold = req.elimination_threshold
    return {"status": "Settings updated", "state": game.get_full_state()}


@app.post("/api/game/generate")
async def generate_answers(req: RoundRequest = None):
    """Phase 1: Generate answers for the current round."""
    situation = req.situation if req else None
    joke_style = req.joke_style if req else None
    roast_victim = req.roast_victim if req else None
    chaos_id = req.chaos_id if req else None
    result = await game.generate_answers_phase(
        custom_situation=situation,
        joke_style=joke_style,
        roast_victim=roast_victim,
        chaos_id=chaos_id,
    )
    return {"result": result, "state": game.get_full_state()}

@app.post("/api/game/vote")
async def execute_voting():
    """Phase 2: Trigger voting, tallying, and progression."""
    result = await game.execute_voting_phase()
    return {"result": result, "state": game.get_full_state()}


@app.post("/api/game/shorts/react")
async def react_to_short(req: ShortReactionRequest):
    """Generate one-line contestant reactions for a YouTube Short."""
    result = await game.generate_short_reactions(
        title=req.title,
        caption=req.caption,
        url=req.url,
    )
    return {"result": result, "state": game.get_full_state()}

@app.get("/api/game/standings")
async def get_standings():
    """Get current scoreboard."""
    return {"standings": game.get_standings(), "state": game.get_full_state()}


@app.get("/api/game/contestants")
async def get_contestants():
    """List all contestants."""
    state = game.get_full_state()
    return {
        "contestants": state["contestants"],
        "chaos_cards": state["chaos_cards"],
    }


@app.post("/api/game/eliminate")
async def eliminate():
    """Eliminate the lowest scorer and trigger evolution."""
    result = await game.eliminate_lowest()
    return {"result": result, "state": game.get_full_state()}

# -----------------------------------------------
# Serve Frontend
# -----------------------------------------------
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))

    @app.get("/shorts")
    async def serve_shorts():
        return FileResponse(os.path.join(frontend_dir, "shorts_fixed.html"))
