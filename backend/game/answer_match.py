"""Match typed answers against one prompt's accepted answers and aliases.

Edit this file to adjust local typo tolerance. Reuse it for other game modes.
"""

import unicodedata


def _normalize(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return " ".join("".join(
        char if char.isalnum() else "" if unicodedata.combining(char) or char in "'’" else " "
        for char in text
    ).split())


def _one_edit(first, second):
    if abs(len(first) - len(second)) > 1:
        return False
    # Skip the shared prefix before testing a substitution, transposition, or extra character.
    index = next((i for i, (a, b) in enumerate(zip(first, second)) if a != b), min(len(first), len(second)))
    first, second = first[index:], second[index:]
    if len(first) == len(second):
        return first[1:] == second[1:] or (first[:2] == second[:2][::-1] and first[2:] == second[2:])
    if len(first) < len(second):
        first, second = second, first
    return first[1:] == second


def find_answer(text, answers):
    variants = [(answer, [answer["answer"], *answer.get("aliases", [])]) for answer in answers]
    folded = text.casefold()
    for answer, names in variants:
        if any(folded == name.casefold() for name in names):
            return answer

    normalized = _normalize(text)
    if not normalized:
        return None
    exact = []
    nearby = []
    for answer, names in variants:
        names = [_normalize(name) for name in names]
        if normalized in names:
            exact.append(answer)
        elif sum(char.isalnum() for char in normalized) >= 5 and any(
            len(name.replace(" ", "")) >= 5 and _one_edit(normalized, name) for name in names
        ):
            nearby.append(answer)
    matches = exact or nearby
    return matches[0] if len(matches) == 1 else None
