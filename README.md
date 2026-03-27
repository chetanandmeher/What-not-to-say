# AI Parliament - "What Not To Say" Comedy Game

Welcome to **AI Parliament**, the backend and frontend for the *What Not To Say* Comedy Game. This project features a REST API built with FastAPI that coordinates different AI "comedian" personas. The API interacts with the Groq API to generate hilarious, persona-driven responses to various situations.

## Features
- **AI Personas**: Multiple AI contestants, each with distinct comedic styles.
- **FastAPI Backend**: A lightweight, high-performance web server that manages the game state, generations, voting, and eliminations.
- **Groq Integration**: Leverages the Groq API for rapid LLM inference.
- **Interactive Web Interface**: A Control Room frontend served directly by the backend where you can manage the game rounds, view standings, and handle eliminations.

## Project Structure
- `backend/`: Contains the game engine, FastAPI server, API routes, Groq client, and personality prompts.
  - `main.py`: The FastAPI server and API routes.
  - `game.py`: The game logic and state management.
  - `groq_client.py`: The client for interacting with the Groq API.
  - `personalities.py`: The system prompts and AI comedian persona definitions.
- `frontend/`: The static frontend (HTML, CSS, JS) acting as the Control Room.

## Prerequisites
- Python 3.10+
- A [Groq API Key](https://console.groq.com/)


## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/chetanandmeher/What-not-to-say.git
   cd What-not-to-say
   ```

2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install dependencies:**
   *(Ensure you have `fastapi`, `uvicorn`, `groq`, and `pydantic` installed)*
   ```bash
   pip install fastapi uvicorn groq pydantic
   ```

4. **Set up Environment Variables:**
   You will need to set your Groq API key. You can export it in your terminal or use a `.env` file if supported.
   ```bash
   # On Windows (Command Prompt):
   set GROQ_API_KEY=your_api_key_here
   # On Windows (PowerShell):
   $env:GROQ_API_KEY="your_api_key_here"
   # On macOS/Linux:
   export GROQ_API_KEY=your_api_key_here
   ```

## Running the Application

1. **Start the backend server:**
   ```bash
   # Make sure you are in the root directory
   uvicorn backend.main:app --reload
   ```

2. **Access the Application:**
   Open your browser and navigate to:
   [http://127.0.0.1:8000/](http://127.0.0.1:8000/)

   The frontend will be served directly by the FastAPI app.

## API Endpoints Overview
- `POST /api/game/start` - Resets and starts a new game.
- `POST /api/game/generate` - Generates AI responses for the current situation.
- `POST /api/game/vote` - Triggers the voting phase and progresses the game.
- `GET /api/game/standings` - Returns the current scoreboard.
- `GET /api/game/contestants` - Lists all participating AI contestants.
- `POST /api/game/eliminate` - Eliminates the lowest-scoring comedian.

## License
MIT License
