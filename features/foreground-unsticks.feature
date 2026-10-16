Feature: A sync that never finishes does not keep the phone on Connecting (mw-q6n8m0.15)

  The Governor, 2026-10-15: "my postern was live from the chain. swiped closed. now Just connecting."
  Only the home probe left the phone after he came back: a sync left hanging blocked every one after it.

  Scenario: mw-q6n8m0.15 AC-1: live from the chain with a sync stuck, a return to the app asks for the messages and the line is Live
    Given the app is live and the event stream is open
    And the stream drops and the sync after it never finishes
    When 10 seconds pass
    Then the badge shows "Live from the chain"
    When he swipes the app away and the backend is answering
    And he comes back to the app
    And 2 seconds pass
    Then the home was probed once
    And the app asked the backend for the messages again
    And the connection reads "live"
    And the badge shows "Live"

  Scenario: mw-q6n8m0.15 AC-2: a sync that never finishes is cut off in bounded time and the next sync goes out
    Given the app is live and the event stream is open
    And the stream drops and the sync after it never finishes
    When 70 seconds pass without his leaving the app
    Then the app asked the backend for the messages again
    And the connection reads "live"

  Scenario: mw-q6n8m0.15 AC-1b: a sync stuck before the app was unlocked again does not keep it on Connecting
    Given the app is live and the event stream is open
    And the stream drops and the sync after it never finishes
    When the app is locked and unlocked again
    And 2 seconds pass
    Then the app asked the backend for the messages again
    And the connection reads "live"
    And the badge shows "Live"
