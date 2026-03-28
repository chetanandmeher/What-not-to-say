import copy


CHAOS_CARDS = [
    {
        "id": "apology-mode",
        "name": "Apology Mode",
        "summary": "Sound fake-sincere, like a celebrity apology that somehow makes everything worse.",
        "prompt": "Deliver the line like a smug, fake-sincere public apology that makes the offense worse.",
    },
    {
        "id": "only-rhymes",
        "name": "Only Rhymes",
        "summary": "The punchline has to rhyme while still landing like a social disaster.",
        "prompt": "Make the line rhyme. It still needs to sound natural, sharp, and socially catastrophic.",
    },
    {
        "id": "hr-nightmare",
        "name": "HR Nightmare",
        "summary": "Say it like someone about to trigger the fastest workplace complaint in history.",
        "prompt": "Frame the line like an unbelievably inappropriate workplace comment that would instantly trigger HR.",
    },
    {
        "id": "villain-defense",
        "name": "Villain Defense",
        "summary": "Speak like you are proudly defending the absolute worst possible behavior.",
        "prompt": "Write the line as if you are confidently defending clearly awful behavior like it is perfectly reasonable.",
    },
    {
        "id": "too-honest",
        "name": "Too Honest",
        "summary": "Blurt out the brutally honest thought that should never leave your brain.",
        "prompt": "Make the line feel brutally, recklessly honest, like an inner thought that should never be said out loud.",
    },
    {
        "id": "conspiracy-brain",
        "name": "Conspiracy Brain",
        "summary": "Everything has to sound like a deranged theory that connects way too many dots.",
        "prompt": "Make the line sound like a paranoid conspiracy theory with absurd confidence.",
    },
    {
        "id": "motivational-speaker",
        "name": "Motivational Speaker",
        "summary": "Package the disaster like an upbeat self-help guru with terrible advice.",
        "prompt": "Deliver the line in the tone of an overconfident motivational speaker giving deeply terrible advice.",
    },
    {
        "id": "courtroom-drama",
        "name": "Courtroom Drama",
        "summary": "Say it like the most theatrical closing argument in a wildly unserious trial.",
        "prompt": "Make the line sound dramatic and theatrical, like a lawyer grandstanding in a ridiculous courtroom.",
    },
]


def list_public_chaos_cards() -> list[dict]:
    """Return frontend-safe chaos card metadata without prompt internals."""
    return [
        {
            "id": card["id"],
            "name": card["name"],
            "summary": card["summary"],
        }
        for card in CHAOS_CARDS
    ]


def get_chaos_card(card_id: str | None) -> dict | None:
    """Return a copy of the requested chaos card, if it exists."""
    if not card_id:
        return None

    for card in CHAOS_CARDS:
        if card["id"] == card_id:
            return copy.deepcopy(card)

    return None
