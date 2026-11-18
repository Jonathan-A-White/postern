Feature: The bead page's status chip does not say In progress for a queued story (mw-ud3caof)

  Scenario: mw-ud3caof AC-1: a story labelled run:queued reads Blocked on the status chip, as on the Map
    Given a story the tracker says is in progress, that mw has labelled run:queued
    When the bead page words its status chip
    Then the chip says Blocked, not In progress
