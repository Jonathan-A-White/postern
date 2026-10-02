Feature: The Prompts screen lists the saved prompts and opens a conversation to run or change one (mw-nqur1n.4)

  Scenario: mw-nqur1n.4: the list shows each prompt with its name, summary and signature
    Given the backend has the prompts "top5" and "sweep"
    When the Prompts screen opens
    Then the row "/top5" shows the summary "The five things that matter"
    And the row "/top5" shows the option chip "--duration 30m"
    And the row "/sweep" lists the option chip "--who"

  Scenario: mw-gq6.236: a prompt that takes free text shows it as <text>
    Given the backend has the prompts "later"
    When the Prompts screen opens
    Then the row "/later" shows the option chip "<text>"

  Scenario: mw-nqur1n.4: Run opens the general channel with the composer saying the prompt's name
    Given the backend has the prompts "top5" and "sweep"
    When the Prompts screen opens
    And Run is tapped on the row "/top5"
    Then the composer holds "/top5 "

  Scenario: mw-nqur1n.4: Edit opens the channel prompt:top5 showing the current body
    Given the backend has the prompts "top5" and "sweep"
    When the Prompts screen opens
    And Edit is tapped on the row "/top5"
    Then the channel "prompt:top5" is open
    And a note headed "Current /top5:" shows the body "List five things, shortest first."

  Scenario: mw-nqur1n.4: a channel that already has words shows no current-body note
    Given the backend has the prompts "top5" and "sweep"
    And the channel "prompt:top5" already has a message from the Mayor
    When the Prompts screen opens
    And Edit is tapped on the row "/top5"
    Then the channel "prompt:top5" is open
    And no "Current /top5:" note is shown

  Scenario: mw-nqur1n.4: offline the cached list shows with the time it was fetched
    Given the phone fetched the prompts "top5" and "sweep" at "09:15" and is now offline
    When the Prompts screen opens
    Then the row "/top5" shows the summary "The five things that matter"
    And the screen says "as of 09:15"

  Scenario: mw-nqur1n.4: with nothing cached and no network the screen says so
    Given the phone has never fetched the prompts and is offline
    When the Prompts screen opens
    Then the screen says "The prompts could not be fetched"

  Scenario: mw-nqur1n.4: the Me screen has a Prompts row that opens the Prompts screen
    When the Me screen opens
    Then a "Prompts" link leads to the Prompts screen

  Scenario: mw-nqur1n.4: the Talk line screen has a Prompts link that opens the Prompts screen
    When the Talk line screen opens
    Then a "Prompts" link leads to the Prompts screen
