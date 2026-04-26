from .schema import ConfidenceScore


COMPLETENESS_WEIGHT = 0.4
CORROBORATION_WEIGHT = 0.6

CORROBORATION_BY_SOURCE_COUNT = {1: 0.3, 2: 0.6}
CORROBORATION_3_PLUS = 1.0


def calculate(completeness: float, num_sources: int, has_conflict: bool = False) -> ConfidenceScore:
    """
    Compute confidence score from completeness ratio and source count.
    Conflicting sources lower corroboration and set needs_review via the caller.
    """
    if num_sources >= 3:
        corroboration = CORROBORATION_3_PLUS
    else:
        corroboration = CORROBORATION_BY_SOURCE_COUNT.get(num_sources, 0.0)

    if has_conflict:
        corroboration *= 0.5

    score = (completeness * COMPLETENESS_WEIGHT) + (corroboration * CORROBORATION_WEIGHT)

    return ConfidenceScore(
        score=round(score, 4),
        completeness=round(completeness, 4),
        corroboration=round(corroboration, 4),
    )
