Feature: A story done and queued for its landing is not listed as Working (mw-8a6vysw)

  Scenario: mw-8a6vysw AC-1: a story labelled run:queued leaves the Working column, the epic's count and the factory's figure
    Given a story the tracker says is in progress, that mw has labelled run:queued
    When the map sorts the work into its columns
    Then the story is not in Working, and the epic and the factory count one story fewer working
