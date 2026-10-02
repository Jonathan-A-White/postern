Feature: A new build waits for his tap and then loads once (mw-yxwtth.1)

  Scenario: AC-1: a worker waiting behind the one in control shows Update ready, tap to reload
    Given Postern is open on a phone whose service worker has a newer build waiting
    Then the update banner reads "Update ready, tap to reload"

  Scenario: AC-2: no waiting worker shows no banner
    Given Postern is open on a phone with nothing waiting
    Then there is no update banner

  Scenario: AC-3: the tap tells the waiting worker to take over and the page reloads once when it has
    Given Postern is open on a phone whose service worker has a newer build waiting
    When he taps the update banner
    Then the waiting worker is sent SKIP_WAITING
    And the banner goes dead and says "Updating…"
    When the new worker takes control twice over
    Then the page has reloaded exactly once

  Scenario: AC-4: the app looks for an update on start, on return to the foreground and every 30 minutes
    Given Postern is open on a phone with nothing waiting
    Then it has looked for an update once
    When the phone brings Postern back to the foreground
    Then it has looked for an update twice
    When 30 minutes pass
    Then it has looked for an update 3 times
